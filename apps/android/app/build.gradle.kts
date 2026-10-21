plugins {
    id("com.android.application")
}

android {
    namespace = "com.noted.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.noted.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 8
        versionName = "0.2.3"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        create("distribution") {
            val path = System.getenv("NOTED_ANDROID_KEYSTORE")
            if (path != null) {
                storeFile = file(path)
                storePassword = System.getenv("NOTED_ANDROID_STORE_PASSWORD")
                keyAlias = System.getenv("NOTED_ANDROID_KEY_ALIAS") ?: "noted"
                keyPassword = System.getenv("NOTED_ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            if (System.getenv("NOTED_ANDROID_KEYSTORE") != null) {
                signingConfig = signingConfigs.getByName("distribution")
            }
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
    implementation(platform("com.google.firebase:firebase-bom:35.0.2"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.work:work-runtime:2.11.2")
    implementation("com.google.android.gms:play-services-wearable:20.0.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
