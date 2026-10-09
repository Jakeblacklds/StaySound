plugins {
    kotlin("jvm") version "2.1.20" apply false
    kotlin("android") version "2.1.20" apply false
    id("com.android.library") version "8.11.0" apply false
    id("com.google.devtools.ksp") version "2.1.20-2.0.1" apply false
}

subprojects { group = "app.staysound.core"; version = "1.0.0" }
