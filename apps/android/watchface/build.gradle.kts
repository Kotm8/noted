plugins { id("com.android.application") }

android {
    enableKotlin = false
    namespace = "com.noted.watchface"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.noted.android.watchfacepush.noted"
        minSdk = 33
        targetSdk = 36
        versionCode = 7
        versionName = "0.2.2"
    }
    signingConfigs {
        create("distribution") {
            System.getenv("NOTED_ANDROID_KEYSTORE")?.let { path ->
                storeFile = file(path)
                storePassword = System.getenv("NOTED_ANDROID_STORE_PASSWORD")
                keyAlias = System.getenv("NOTED_ANDROID_KEY_ALIAS") ?: "noted"
                keyPassword = System.getenv("NOTED_ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        debug {
            isMinifyEnabled = true
            isShrinkResources = false
        }
        release {
            if (System.getenv("NOTED_ANDROID_KEYSTORE") != null) signingConfig = signingConfigs.getByName("distribution")
            isMinifyEnabled = true
            isShrinkResources = false
        }
    }
}
