import java.io.ByteArrayOutputStream
import org.gradle.process.ExecOperations

plugins {
    id("com.android.application")
}

android {
    namespace = "com.noted.wear"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.noted.android"
        minSdk = 33
        targetSdk = 36
        versionCode = 7
        versionName = "0.2.2"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
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
    implementation("androidx.fragment:fragment:1.8.9")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.wear:wear:1.3.0")
    implementation("androidx.wear.watchfacepush:watchfacepush:1.0.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.wear.watchface:watchface-complications-data-source-ktx:1.2.1")
    implementation("androidx.wear.tiles:tiles:1.5.0")
    implementation("androidx.wear.protolayout:protolayout:1.3.0")
    implementation("androidx.concurrent:concurrent-futures:1.2.0")
    implementation("com.google.android.gms:play-services-wearable:20.0.1")
    implementation(platform("com.google.firebase:firebase-bom:35.0.2"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.work:work-runtime:2.11.2")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}

abstract class BundleWatchFace : DefaultTask() {
    @get:InputFile
    abstract val apk: RegularFileProperty

    @get:Classpath
    abstract val validator: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty

    @get:Inject
    abstract val execOperations: ExecOperations

    @TaskAction
    fun bundle() {
        val output = ByteArrayOutputStream()
        execOperations.javaexec {
            classpath = validator
            mainClass.set("com.google.android.wearable.watchface.validator.cli.DwfValidation")
            args("--apk_path=${apk.get().asFile.absolutePath}", "--package_name=com.noted.android")
            standardOutput = output
            errorOutput = output
        }.assertNormalExitValue()
        val report = output.toString(Charsets.UTF_8)
        val token = Regex("generated token: ([^\\r\\n]+)").find(report)?.groupValues?.get(1)?.trim()
            ?: throw GradleException("Watch Face Push validation failed:\n$report")
        val directory = outputDirectory.get().asFile.resolve("watchface").apply { mkdirs() }
        apk.get().asFile.copyTo(directory.resolve("noted.apk"), overwrite = true)
        directory.resolve("validation-token.txt").writeText(token)
        logger.lifecycle("Validated and bundled the Noted watch face.")
    }
}

val watchFaceValidator by configurations.creating {
    isCanBeConsumed = false
    isTransitive = false
}

dependencies {
    watchFaceValidator("com.google.android.wearable.watchface.validator:validator-push-cli:1.1.0-alpha01")
}

androidComponents {
    onVariants { variant ->
        val buildType = variant.buildType ?: return@onVariants
        val capitalized = buildType.replaceFirstChar { it.uppercase() }
        val bundle = tasks.register<BundleWatchFace>("bundle${capitalized}WatchFace") {
            dependsOn(":watchface:assemble$capitalized")
            apk.set(project(":watchface").layout.buildDirectory.file("outputs/apk/$buildType/watchface-$buildType.apk"))
            validator.from(watchFaceValidator)
            outputDirectory.set(layout.buildDirectory.dir("generated/watchfaceAssets/$buildType"))
        }
        variant.sources.assets?.addGeneratedSourceDirectory(bundle, BundleWatchFace::outputDirectory)
    }
}
