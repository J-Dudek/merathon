# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Méthodes appelées depuis l'interface web (MainActivity.SystemBars).
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Clé SSH de l'appareil (MerathonKeystore.kt) : appelée uniquement depuis Rust par JNI, donc invisible pour R8.
-keep class com.gitclient.app.MerathonKeystore { public static *; }
-keep class com.gitclient.app.MerathonKeystore$ConfirmFragment { *; }

# Vérification des PR en arrière-plan (MerathonPrWatch.kt) : programmée depuis Rust par JNI, et sa méthode native
# est trouvée par son nom (Java_com_gitclient_app_MerathonPrWatch_check).
-keep class com.gitclient.app.MerathonPrWatch {
    public static *;
    native <methods>;
}
-keep class com.gitclient.app.MerathonPrWatch$Check { <init>(...); }
# WorkManager crée sa base Room (WorkDatabase_Impl) par réflexion : sans cette règle, R8 retire son constructeur et
# l'application plante au démarrage (NoSuchMethodException dans InitializationProvider).
-keep class * extends androidx.room.RoomDatabase { <init>(); }
