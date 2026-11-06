package com.gitclient.app

import android.app.Activity
import android.app.Fragment
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import java.lang.ref.WeakReference
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

/**
 * Clé SSH de l'appareil (issue #38) : une clé ECDSA P-256 créée dans l'Android Keystore, qui n'en sort jamais.
 *
 * Appelée depuis Rust par JNI (src-tauri/src/android_keystore.rs), toujours depuis un fil de travail de libgit2, jamais
 * depuis le fil de l'interface : `sign` peut y attendre la confirmation de l'utilisateur sans figer l'application.
 *
 * Chaque utilisation exige l'empreinte digitale ou le code de l'appareil ; une confirmation vaut
 * [AUTH_VALIDITY_SECONDS] secondes, pour enchaîner fetch puis push sans la redemander. Sans verrouillage d'écran,
 * aucune clé n'est créée : il n'y a pas de repli sur une clé en clair.
 *
 * Les erreurs sont des [IllegalStateException] dont le message commence par un code (`absent:`, `locked:`,
 * `cancelled:`, `invalidated:`, `insecure:`, `exists:`, `busy:`) : Rust en fait un message traduit.
 * Uniquement des API de la plateforme (pas d'androidx), de l'API 24 à aujourd'hui.
 */
object MerathonKeystore {
  private const val TAG = "MerathonKeystore"
  private const val ALIAS = "merathon-ssh"
  private const val PROVIDER = "AndroidKeyStore"
  private const val AUTH_VALIDITY_SECONDS = 30
  private const val CONFIRM_TIMEOUT_SECONDS = 120L
  private const val CONFIRM_REQUEST = 0x5354 // « ST »

  @Volatile private var activity: WeakReference<Activity>? = null

  /** Appelé par MainActivity.onCreate : la confirmation s'affiche par-dessus cette activité. */
  @JvmStatic
  fun attach(current: Activity) {
    activity = WeakReference(current)
  }

  private fun fail(code: String, detail: String = code): Nothing = throw IllegalStateException("$code: $detail")

  private fun keyStore(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

  private fun privateKey(): PrivateKey? = keyStore().getKey(ALIAS, null) as? PrivateKey

  private fun currentActivity(): Activity = activity?.get() ?: fail("busy", "no activity")

  private fun isDeviceSecure(context: Context): Boolean =
    (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure

  /** Clé publique (SubjectPublicKeyInfo DER), ou null s'il n'y a pas encore de clé. */
  @JvmStatic
  fun publicKey(): ByteArray? = keyStore().getCertificate(ALIAS)?.publicKey?.encoded

  /**
   * `absent`, `ready`, `invalidated` (verrouillage d'écran retiré, clé inutilisable) ou `insecure` (pas de
   * verrouillage d'écran). Ne demande jamais de confirmation.
   */
  @JvmStatic
  fun state(context: Context): String {
    val key = privateKey()
    if (!isDeviceSecure(context)) return if (key == null) "insecure" else "invalidated"
    if (key == null) return "absent"
    return try {
      Signature.getInstance("SHA256withECDSA").initSign(key)
      "ready"
    } catch (e: UserNotAuthenticatedException) {
      "ready"
    } catch (e: KeyPermanentlyInvalidatedException) {
      "invalidated"
    }
  }

  /** Crée la clé et renvoie sa clé publique. Ne remplace jamais une clé existante. */
  @JvmStatic
  fun create(context: Context): ByteArray {
    if (!isDeviceSecure(context)) fail("insecure")
    if (keyStore().containsAlias(ALIAS)) fail("exists")
    val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setUserAuthenticationRequired(true)
    if (Build.VERSION.SDK_INT >= 30) {
      spec.setUserAuthenticationParameters(
        AUTH_VALIDITY_SECONDS,
        KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL
      )
    } else {
      @Suppress("DEPRECATION")
      spec.setUserAuthenticationValidityDurationSeconds(AUTH_VALIDITY_SECONDS)
    }
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER)
    generator.initialize(spec.build())
    return generator.generateKeyPair().public.encoded
  }

  /** Supprime la clé (par exemple invalidée) ; sans effet s'il n'y en a pas. */
  @JvmStatic
  fun delete() {
    val store = keyStore()
    if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS)
  }

  /**
   * Signature SHA256withECDSA (DER) de `data`. Si la dernière confirmation a expiré, demande l'empreinte ou le code
   * de l'appareil, sauf si `allowPrompt` est faux (synchronisation en arrière-plan) : l'appel échoue alors en `locked`.
   */
  @JvmStatic
  fun sign(data: ByteArray, allowPrompt: Boolean, title: String, subtitle: String): ByteArray {
    val key = privateKey() ?: fail("absent")
    return try {
      signWith(key, data)
    } catch (e: KeyPermanentlyInvalidatedException) {
      fail("invalidated")
    } catch (e: UserNotAuthenticatedException) {
      if (!allowPrompt) fail("locked")
      confirm(title, subtitle)
      try {
        signWith(key, data)
      } catch (e: KeyPermanentlyInvalidatedException) {
        fail("invalidated")
      } catch (e: UserNotAuthenticatedException) {
        fail("cancelled", "confirmation expired")
      }
    }
  }

  private fun signWith(key: PrivateKey, data: ByteArray): ByteArray {
    val signature = Signature.getInstance("SHA256withECDSA")
    signature.initSign(key)
    signature.update(data)
    return signature.sign()
  }

  /** Affiche la confirmation sur le fil de l'interface et bloque le fil appelant jusqu'à la réponse. */
  private fun confirm(title: String, subtitle: String) {
    if (Looper.myLooper() == Looper.getMainLooper()) fail("busy", "sign() called on the main thread")
    val host = currentActivity()
    val done = CountDownLatch(1)
    var accepted = false
    // Fenêtre impossible à afficher (permission manquante…) : ce n'est pas une annulation, la cause doit rester visible.
    var failure: String? = null
    val finish = { ok: Boolean ->
      accepted = ok
      done.countDown()
    }
    host.runOnUiThread {
      try {
        if (Build.VERSION.SDK_INT >= 30) promptBiometric(host, title, subtitle, finish) else promptCredential(host, title, subtitle, finish)
      } catch (e: RuntimeException) {
        Log.w(TAG, "confirmation could not be shown", e)
        failure = e.toString()
        finish(false)
      }
    }
    val answered = done.await(CONFIRM_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    failure?.let { fail("prompt", it) }
    if (!answered || !accepted) fail("cancelled")
  }

  /** Android 11 et suivants : empreinte digitale (ou visage de classe forte), avec repli sur le code de l'appareil. */
  private fun promptBiometric(host: Activity, title: String, subtitle: String, finish: (Boolean) -> Unit) {
    val prompt = BiometricPrompt.Builder(host)
      .setTitle(title)
      .setSubtitle(subtitle)
      .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
      .build()
    val mainThread = Handler(Looper.getMainLooper())
    prompt.authenticate(CancellationSignal(), Executor { mainThread.post(it) }, object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = finish(true)
      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
        Log.i(TAG, "confirmation ended: $errorCode $errString")
        finish(false)
      }
      // Un doigt non reconnu : la fenêtre reste ouverte pour un nouvel essai.
      override fun onAuthenticationFailed() {}
    })
  }

  /** Android 7 à 10 : écran de déverrouillage du système (code, schéma, et selon l'appareil empreinte). */
  @Suppress("DEPRECATION")
  private fun promptCredential(host: Activity, title: String, subtitle: String, finish: (Boolean) -> Unit) {
    val keyguard = host.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    val intent = keyguard.createConfirmDeviceCredentialIntent(title, subtitle) ?: fail("insecure")
    val fragment = ConfirmFragment()
    fragment.intent = intent
    fragment.finish = finish
    host.fragmentManager.beginTransaction().add(fragment, "merathon-ssh-confirm").commitAllowingStateLoss()
  }

  /** Fragment sans vue qui reçoit le résultat de l'écran de déverrouillage, sans toucher à MainActivity. */
  @Suppress("DEPRECATION")
  class ConfirmFragment : Fragment() {
    var intent: Intent? = null
    var finish: ((Boolean) -> Unit)? = null
    private var started = false

    override fun onResume() {
      super.onResume()
      val pending = intent
      if (!started && pending != null) {
        started = true
        startActivityForResult(pending, CONFIRM_REQUEST)
      } else if (pending == null) {
        // Fragment recréé par le système : la demande d'origine n'existe plus.
        close(false)
      }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode == CONFIRM_REQUEST) close(resultCode == Activity.RESULT_OK)
    }

    private fun close(ok: Boolean) {
      finish?.invoke(ok)
      finish = null
      fragmentManager?.beginTransaction()?.remove(this)?.commitAllowingStateLoss()
    }
  }
}
