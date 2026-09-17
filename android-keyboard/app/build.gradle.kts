plugins {
    id("com.android.application")
}

android {
    namespace = "com.ana.keyboard"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.ana.keyboard"
        minSdk = 28
        targetSdk = 37
        versionCode = 10
        versionName = "0.10.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
