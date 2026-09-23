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
        versionCode = 21
        versionName = "0.20.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}


dependencies {
    testImplementation("junit:junit:4.13.2")
}
