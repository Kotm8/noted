pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "NotedAndroid"
include(":app")
include(":wear")
include(":watchface")

include(":capacitor-android")
project(":capacitor-android").projectDir = file("../web/node_modules/@capacitor/android/capacitor")
