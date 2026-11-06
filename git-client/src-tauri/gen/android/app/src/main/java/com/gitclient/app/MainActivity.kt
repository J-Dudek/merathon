package com.gitclient.app

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // La confirmation de la clé SSH de l'appareil (MerathonKeystore.kt) s'affiche par-dessus cette activité.
    MerathonKeystore.attach(this)
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(SystemBars(), "MerathonSystemBars")
    // En plein écran, Android ne réduit plus la page sous le clavier : sans cela, les champs du bas passeraient dessous.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { view, insets ->
      view.setPadding(0, 0, 0, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
      insets
    }
  }

  /** Icônes des barres système selon le thème de l'application, qui peut différer de celui d'Android (voir theme.ts). */
  private inner class SystemBars {
    @JavascriptInterface
    fun setDark(dark: Boolean) = runOnUiThread {
      val bars = WindowCompat.getInsetsController(window, window.decorView)
      bars.isAppearanceLightStatusBars = !dark
      bars.isAppearanceLightNavigationBars = !dark
    }
  }
}
