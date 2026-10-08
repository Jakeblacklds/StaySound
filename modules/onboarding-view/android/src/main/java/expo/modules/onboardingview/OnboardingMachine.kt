package expo.modules.onboardingview

import org.json.JSONArray
import org.json.JSONObject

internal fun String.jsTrim() = trim { it.isWhitespace() || it == '﻿' || it == ' ' }

/** One Soulseek result offered in the trial download. [id] is opaque; JS keeps the real match. */
internal data class Found(val id: String, val title: String, val artist: String, val detail: String) {
    fun json(): JSONObject = JSONObject().put("id", id).put("title", title).put("artist", artist).put("detail", detail)
    companion object {
        fun list(value: JSONArray?) = (0 until (value?.length() ?: 0)).mapNotNull { value?.optJSONObject(it) }
            .map { Found(it.optString("id"), it.optString("title"), it.optString("artist"), it.optString("detail")) }
    }
}
internal data class Effect(val action: String, val id: Long, val payload: JSONObject = JSONObject())

/**
 * Pure UI state machine for the first run: welcome, your music, Soulseek account, a trial
 * download, done. Permissions, credentials, searching and downloading are effects answered by
 * the JS adapter. Nothing here can trap the user: every step past the first has a way forward.
 */
internal class OnboardingMachine {
    enum class Step { welcome, music, account, tryIt, ready }
    enum class Transfer { idle, running, done, failed }

    var step = Step.welcome; private set
    var name = ""
    var granted = false; private set
    var username = ""
    /** Never part of a checkpoint; it only lives until it is handed to the adapter. */
    var password = ""
    var connected = false; private set
    var saving = false; private set
    var accountError = ""; private set
    var query = ""
    var searching = false; private set
    var searched = false; private set
    var results = emptyList<Found>(); private set
    var searchError = ""; private set
    var transfer = Transfer.idle; private set
    var transferId = ""; private set
    var progress = 0; private set
    var transferError = ""; private set
    var finishing = false; private set
    var completed = false; private set
    var lastReply = 0L; private set
    private var serial = 0L
    private var saveId = -1L
    private var searchId = -1L
    private var downloadId = -1L
    private var finishId = -1L
    private val effects = mutableListOf<Effect>()

    val canSearch get() = !searching && transfer != Transfer.running && query.jsTrim().length >= 2
    val canSave get() = !saving && username.jsTrim().isNotEmpty() && password.jsTrim().isNotEmpty()

    private fun emit(action: String, payload: JSONObject = JSONObject()): Long {
        val id = ++serial
        effects.add(Effect(action, id, payload)); return id
    }
    fun drainEffects(): List<Effect> = effects.toList().also { effects.clear() }

    /** The primary button. On the account step it only moves on once an account is saved. */
    fun advance() {
        if (finishing || completed) return
        step = when (step) {
            Step.welcome -> Step.music
            Step.music -> Step.account
            Step.account -> if (connected) Step.tryIt else return
            Step.tryIt -> if (transfer == Transfer.running) return else Step.ready
            Step.ready -> return
        }
        enter()
    }
    /** "Ahora no". Without an account there is nothing to try, so that skip lands on the end. */
    fun skip() {
        if (finishing || completed || saving) return
        step = when (step) {
            Step.account -> Step.ready
            Step.tryIt -> if (transfer == Transfer.running) return else Step.ready
            else -> return
        }
        enter()
    }
    fun back() {
        if (finishing || completed || saving || transfer == Transfer.running) return
        step = when (step) {
            Step.music -> Step.welcome
            Step.account -> Step.music
            Step.tryIt -> Step.account
            Step.ready -> if (connected) Step.tryIt else Step.account
            Step.welcome -> return
        }
        enter()
    }
    fun enter() {
        if (step == Step.music) emit("checkPermission")
        if (step == Step.account) emit("account")
    }
    fun requestPermission() { emit("permission") }
    fun saveAccount() {
        if (!canSave) return
        saving = true; accountError = ""
        saveId = emit("credentials", JSONObject().put("username", username.jsTrim()).put("password", password.jsTrim()))
    }
    fun search() {
        if (!canSearch) return
        searching = true; searchError = ""
        searchId = emit("search", JSONObject().put("query", query.jsTrim()))
    }
    fun download(found: Found) {
        if (step != Step.tryIt || transfer == Transfer.running) return
        transfer = Transfer.running; transferId = found.id; progress = 1; transferError = ""
        downloadId = emit("download", JSONObject().put("id", found.id))
    }
    fun finish() {
        if (step != Step.ready || finishing || completed) return
        finishing = true
        finishId = emit("finish", JSONObject().put("name", name))
    }

    fun reply(reply: JSONObject) {
        val sequence = reply.optLong("sequence")
        if (sequence <= lastReply) return
        lastReply = sequence
        val id = reply.optLong("id")
        val data = reply.optJSONObject("data") ?: JSONObject()
        when (reply.optString("action")) {
            "permission", "checkPermission" -> if (data.has("granted")) granted = data.getBoolean("granted")
            "account" -> if (!saving && data.has("connected")) {
                connected = data.optBoolean("connected")
                if (connected && username.isEmpty()) username = data.optString("username")
            }
            "credentials" -> if (id == saveId && saving) {
                saving = false
                if (data.optBoolean("saved")) {
                    connected = true; password = ""
                    if (step == Step.account) { step = Step.tryIt; enter() }
                } else accountError = data.optString("error").ifEmpty { "No se pudo guardar la cuenta." }
            }
            "search" -> if (id == searchId && searching) {
                searching = false; searched = true
                results = Found.list(data.optJSONArray("results"))
                searchError = data.optString("error")
            }
            "download" -> if (id == downloadId && transfer == Transfer.running) when {
                data.optBoolean("done") -> { transfer = Transfer.done; progress = 100 }
                data.has("error") -> { transfer = Transfer.failed; transferError = data.optString("error") }
                data.has("progress") -> progress = data.optInt("progress").coerceIn(progress, 99)
            }
            "finish" -> if (id == finishId && finishing && !completed) {
                finishing = false
                if (data.optBoolean("success")) { completed = true; emit("completed") }
            }
        }
    }

    fun snapshot(): String = JSONObject().put("step", step.name).put("name", name).put("granted", granted)
        .put("username", username).put("connected", connected).put("saving", saving).put("accountError", accountError)
        .put("query", query).put("searching", searching).put("searched", searched)
        .put("results", JSONArray(results.map { it.json() })).put("searchError", searchError)
        .put("transfer", transfer.name).put("transferId", transferId).put("progress", progress).put("transferError", transferError)
        .put("finishing", finishing).put("completed", completed).put("lastReply", lastReply).put("serial", serial)
        .put("saveId", saveId).put("searchId", searchId).put("downloadId", downloadId).put("finishId", finishId).toString()

    fun restore(raw: String) {
        val data = runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
        step = runCatching { Step.valueOf(data.optString("step", "welcome")) }.getOrDefault(Step.welcome)
        name = data.optString("name"); granted = data.optBoolean("granted")
        username = data.optString("username"); password = ""
        connected = data.optBoolean("connected"); accountError = data.optString("accountError")
        // A save in flight cannot be resumed without the password, so it is offered again.
        saving = false
        query = data.optString("query"); searching = data.optBoolean("searching"); searched = data.optBoolean("searched")
        results = Found.list(data.optJSONArray("results")); searchError = data.optString("searchError")
        transfer = runCatching { Transfer.valueOf(data.optString("transfer", "idle")) }.getOrDefault(Transfer.idle)
        transferId = data.optString("transferId"); progress = data.optInt("progress"); transferError = data.optString("transferError")
        finishing = data.optBoolean("finishing"); completed = data.optBoolean("completed")
        lastReply = data.optLong("lastReply"); serial = data.optLong("serial")
        saveId = -1; searchId = data.optLong("searchId", -1); downloadId = data.optLong("downloadId", -1)
        finishId = data.optLong("finishId", -1)
        effects.clear()
    }
}
