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
        versionCode = 18
        versionName = "0.5.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        buildConfig = true
    }
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
    sourceSets.getByName("main") {
        assets.directories.add(layout.buildDirectory.dir("generated/notedPhoneAssets").get().asFile.path)
    }
}

dependencies {
    implementation(project(":capacitor-android"))
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("io.coil-kt:coil-base:2.7.0")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation(platform("com.google.firebase:firebase-bom:35.0.2"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.android.gms:play-services-wearable:20.0.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}

val bundle = layout.buildDirectory.dir("noted-phone-web")
val packagePhoneAssets = tasks.register<Sync>("packagePhoneAssets") {
    from(bundle) { into("public") }
    into(layout.buildDirectory.dir("generated/notedPhoneAssets"))
    doFirst {
        check(bundle.get().file("index.html").asFile.isFile) {
            "Run python scripts/android.py check to build the packaged phone assets."
        }
    }
}
tasks.named("preBuild") { dependsOn(packagePhoneAssets) }
