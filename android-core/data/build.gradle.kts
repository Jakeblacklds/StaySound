plugins {
    id("com.android.library")
    kotlin("android")
    id("com.google.devtools.ksp")
}
android {
    namespace = "app.staysound.core.data"
    compileSdk = 36
    defaultConfig { minSdk = 24 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    testOptions { unitTests.isIncludeAndroidResources = true }
}
kotlin { jvmToolchain(17) }
ksp { arg("room.schemaLocation", "$projectDir/schemas") }
dependencies {
    api(project(":model"))
    implementation("androidx.room:room-runtime:2.7.2")
    implementation("androidx.room:room-ktx:2.7.2")
    ksp("androidx.room:room-compiler:2.7.2")
    implementation("androidx.datastore:datastore-preferences:1.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.9.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}

tasks.register("verifyNoReactRuntime") {
    doLast {
        val forbidden = configurations.getByName("debugRuntimeClasspath").resolvedConfiguration.resolvedArtifacts
            .map { it.moduleVersion.id }.filter { it.group.startsWith("com.facebook.react") || it.group.startsWith("expo.") || it.group == "host.exp.exponent" }
        check(forbidden.isEmpty()) { "Android core acquired a React/Expo runtime dependency: $forbidden" }
    }
}
