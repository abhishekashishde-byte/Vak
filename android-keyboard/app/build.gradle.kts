plugins {
    id("com.android.application")
}

val releaseKeystorePath = System.getenv("ANA_KEYSTORE_PATH")
val releaseKeystorePassword = System.getenv("ANA_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("ANA_KEY_ALIAS")
val releaseKeyPassword = System.getenv("ANA_KEY_PASSWORD")
val releaseSigningReady = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword
).all { !it.isNullOrBlank() }

android {
    namespace = "com.ana.keyboard"
    compileSdk = 37

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "com.ana.keyboard"
        minSdk = 28
        targetSdk = 37
        versionCode = 29
        versionName = "0.21.5"
    }

    signingConfigs {
        if (releaseSigningReady) {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        getByName("release") {
            if (releaseSigningReady) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}


dependencies {
    testImplementation("junit:junit:4.13.2")
}
