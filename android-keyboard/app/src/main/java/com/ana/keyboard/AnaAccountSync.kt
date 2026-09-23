package com.ana.keyboard

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Ana account + keyboard learning sync.
 *
 * Normal typing never waits on this class. Mutations are written locally first
 * and sync is debounced on a background executor. Touch calibration is
 * intentionally excluded because it belongs to one physical device.
 */
object AnaAccountSync {
    private const val PROJECT_URL = "https://vodkxcjregviexhtwkrw.supabase.co"
    private const val PUBLISHABLE_KEY = "sb_publishable_8_SLHlG2FxHlHXs-PQEO2Q_da_dKCv6"
    private const val SESSION_STORE = "ana_account_session"
    private const val SESSION_KEY = "encrypted_session"
    private const val KEY_ALIAS = "ana_keyboard_account_session_v1"

    data class Session(
        val accessToken: String,
        val refreshToken: String,
        val userId: String,
        val email: String,
        val expiresAtEpochSeconds: Long
    )

    data class SyncSummary(
        val email: String,
        val uploaded: Int,
        val remoteEntries: Int
    )

    fun signedInEmail(context: Context): String? = readSession(context)?.email?.takeIf { it.isNotBlank() }

    fun isSignedIn(context: Context): Boolean = readSession(context) != null

    fun signOut(context: Context) {
        context.getSharedPreferences(SESSION_STORE, Context.MODE_PRIVATE)
            .edit().remove(SESSION_KEY).apply()
    }

    fun signInAndSync(context: Context, email: String, password: String): SyncSummary {
        val cleanEmail = email.trim()
        require(cleanEmail.isNotBlank()) { "Enter your email." }
        require(password.length >= 8) { "Enter your password." }

        val response = request(
            url = "$PROJECT_URL/auth/v1/token?grant_type=password",
            method = "POST",
            body = JSONObject().put("email", cleanEmail).put("password", password).toString()
        )
        if (response.first !in 200..299) throw IllegalStateException(apiError(response.second, "Sign in failed."))

        val json = JSONObject(response.second)
        val user = json.optJSONObject("user")
        val userId = user?.optString("id").orEmpty()
        val returnedEmail = user?.optString("email").orEmpty().ifBlank { cleanEmail }
        val access = json.optString("access_token")
        val refresh = json.optString("refresh_token")
        if (access.isBlank() || refresh.isBlank() || userId.isBlank()) {
            throw IllegalStateException("Ana sign in did not return a usable session.")
        }

        val expiresIn = json.optLong("expires_in", 3600L).coerceAtLeast(60L)
        val session = Session(
            accessToken = access,
            refreshToken = refresh,
            userId = userId,
            email = returnedEmail,
            expiresAtEpochSeconds = Instant.now().epochSecond + expiresIn
        )
        writeSession(context, session)
        return KeyboardLearningSync.syncNow(context, session)
    }

    fun syncNow(context: Context): SyncSummary {
        val session = freshSession(context) ?: throw IllegalStateException("Sign in to your Ana account first.")
        return KeyboardLearningSync.syncNow(context, session)
    }

    internal fun freshSession(context: Context): Session? {
        val existing = readSession(context) ?: return null
        if (existing.expiresAtEpochSeconds > Instant.now().epochSecond + 90L) return existing

        val response = request(
            url = "$PROJECT_URL/auth/v1/token?grant_type=refresh_token",
            method = "POST",
            body = JSONObject().put("refresh_token", existing.refreshToken).toString()
        )
        if (response.first !in 200..299) {
            if (response.first == 400 || response.first == 401 || response.first == 403) signOut(context)
            throw IllegalStateException(apiError(response.second, "Ana session expired. Please sign in again."))
        }

        val json = JSONObject(response.second)
        val access = json.optString("access_token")
        val refresh = json.optString("refresh_token").ifBlank { existing.refreshToken }
        val user = json.optJSONObject("user")
        val userId = user?.optString("id").orEmpty().ifBlank { existing.userId }
        val email = user?.optString("email").orEmpty().ifBlank { existing.email }
        if (access.isBlank()) throw IllegalStateException("Ana could not refresh the account session.")

        val next = existing.copy(
            accessToken = access,
            refreshToken = refresh,
            userId = userId,
            email = email,
            expiresAtEpochSeconds = Instant.now().epochSecond + json.optLong("expires_in", 3600L).coerceAtLeast(60L)
        )
        writeSession(context, next)
        return next
    }

    internal fun fetchSharedGlossary(session: Session): List<KeyboardPrefs.SharedGlossaryEntry> {
        val response = request(
            url = "$PROJECT_URL/auth/v1/user",
            method = "GET",
            bearer = session.accessToken
        )
        if (response.first !in 200..299) return emptyList()
        return try {
            val user = JSONObject(response.second.ifBlank { "{}" })
            val glossary = user.optJSONObject("user_metadata")
                ?.optJSONObject("ana_preferences")
                ?.optJSONArray("glossary")
                ?: JSONArray()
            buildList {
                for (i in 0 until glossary.length()) {
                    val item = glossary.optJSONObject(i) ?: continue
                    val source = item.optString("source").trim()
                    if (source.isBlank()) continue
                    add(KeyboardPrefs.SharedGlossaryEntry(
                        target = item.optString("target").trim(),
                        source = source,
                        preferred = item.optString("preferred").trim(),
                        scope = item.optString("scope", "personal").trim().ifBlank { "personal" },
                        context = item.optString("context").trim(),
                        rule = item.optString("rule", "preferred").trim().ifBlank { "preferred" }
                    ))
                }
            }
        } catch (_: Exception) { emptyList() }
    }

    internal fun fetchLearning(session: Session): List<KeyboardLearningSync.Entry> {
        val columns = "entry_key,entry_type,language,source,preferred,deleted,client_updated_at"
        val response = request(
            url = "$PROJECT_URL/rest/v1/keyboard_learning_entries?select=$columns&order=client_updated_at.asc",
            method = "GET",
            bearer = session.accessToken
        )
        if (response.first !in 200..299) throw IllegalStateException(apiError(response.second, "Could not download Ana keyboard data."))
        val array = JSONArray(response.second.ifBlank { "[]" })
        return buildList {
            for (i in 0 until array.length()) {
                KeyboardLearningSync.Entry.fromJson(array.optJSONObject(i))?.let { add(it) }
            }
        }
    }

    internal fun upsertLearning(session: Session, entries: Collection<KeyboardLearningSync.Entry>) {
        if (entries.isEmpty()) return
        val rows = JSONArray()
        entries.forEach { entry ->
            rows.put(JSONObject().apply {
                put("user_id", session.userId)
                put("entry_key", entry.entryKey)
                put("entry_type", entry.entryType)
                put("language", entry.language)
                put("source", entry.source)
                put("preferred", entry.preferred ?: JSONObject.NULL)
                put("deleted", entry.deleted)
                put("client_updated_at", entry.clientUpdatedAt)
                put("updated_at", Instant.now().toString())
            })
        }
        val response = request(
            url = "$PROJECT_URL/rest/v1/keyboard_learning_entries?on_conflict=user_id,entry_key",
            method = "POST",
            bearer = session.accessToken,
            body = rows.toString(),
            prefer = "resolution=merge-duplicates,return=minimal"
        )
        if (response.first !in 200..299) throw IllegalStateException(apiError(response.second, "Could not upload Ana keyboard data."))
    }

    private fun request(
        url: String,
        method: String,
        bearer: String? = null,
        body: String? = null,
        prefer: String? = null
    ): Pair<Int, String> {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 12_000
        connection.readTimeout = 20_000
        connection.setRequestProperty("apikey", PUBLISHABLE_KEY)
        connection.setRequestProperty("Accept", "application/json")
        bearer?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
        prefer?.let { connection.setRequestProperty("Prefer", it) }
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        connection.disconnect()
        return code to text
    }

    private fun apiError(raw: String, fallback: String): String = try {
        val json = JSONObject(raw.ifBlank { "{}" })
        json.optString("msg").ifBlank {
            json.optString("message").ifBlank {
                json.optString("error_description").ifBlank {
                    json.optString("error").ifBlank { fallback }
                }
            }
        }
    } catch (_: Exception) {
        fallback
    }

    private fun writeSession(context: Context, session: Session) {
        val json = JSONObject()
            .put("access_token", session.accessToken)
            .put("refresh_token", session.refreshToken)
            .put("user_id", session.userId)
            .put("email", session.email)
            .put("expires_at", session.expiresAtEpochSeconds)
            .toString()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encodedIv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val encodedData = Base64.encodeToString(cipher.doFinal(json.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        context.getSharedPreferences(SESSION_STORE, Context.MODE_PRIVATE)
            .edit().putString(SESSION_KEY, "$encodedIv.$encodedData").apply()
    }

    private fun readSession(context: Context): Session? {
        val raw = context.getSharedPreferences(SESSION_STORE, Context.MODE_PRIVATE)
            .getString(SESSION_KEY, null) ?: return null
        return try {
            val parts = raw.split('.', limit = 2)
            if (parts.size != 2) return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey(),
                GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP))
            )
            val json = JSONObject(String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8))
            Session(
                accessToken = json.optString("access_token"),
                refreshToken = json.optString("refresh_token"),
                userId = json.optString("user_id"),
                email = json.optString("email"),
                expiresAtEpochSeconds = json.optLong("expires_at", 0L)
            ).takeIf { it.accessToken.isNotBlank() && it.refreshToken.isNotBlank() && it.userId.isNotBlank() }
        } catch (_: Exception) {
            // Keystore keys intentionally do not survive an unrelated device
            // restore. The user simply signs in again; glossary data remains in Ana.
            context.getSharedPreferences(SESSION_STORE, Context.MODE_PRIVATE)
                .edit().remove(SESSION_KEY).apply()
            null
        }
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            )
            generateKey()
        }
    }
}

object KeyboardLearningSync {
    private const val STORE = "ana_keyboard_sync"
    private const val KEY_PENDING = "pending_mutations_v1"
    private const val KEY_BOUND_USER = "bound_user_v1"
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private var scheduled: ScheduledFuture<*>? = null
    private val lock = Any()

    data class Entry(
        val entryKey: String,
        val entryType: String,
        val language: String,
        val source: String,
        val preferred: String?,
        val deleted: Boolean,
        val clientUpdatedAt: String
    ) {
        fun toJson(): JSONObject = JSONObject()
            .put("entry_key", entryKey)
            .put("entry_type", entryType)
            .put("language", language)
            .put("source", source)
            .put("preferred", preferred ?: JSONObject.NULL)
            .put("deleted", deleted)
            .put("client_updated_at", clientUpdatedAt)

        companion object {
            fun fromJson(json: JSONObject?): Entry? {
                json ?: return null
                val key = json.optString("entry_key")
                val type = json.optString("entry_type")
                val language = json.optString("language")
                val source = json.optString("source")
                if (key.isBlank() || type.isBlank() || language.isBlank() || source.isBlank()) return null
                return Entry(
                    entryKey = key,
                    entryType = type,
                    language = language,
                    source = source,
                    preferred = if (json.isNull("preferred")) null else json.optString("preferred").takeIf { it.isNotBlank() },
                    deleted = json.optBoolean("deleted", false),
                    clientUpdatedAt = json.optString("client_updated_at").ifBlank { Instant.EPOCH.toString() }
                )
            }
        }
    }

    fun recordPersonalWord(context: Context, language: String, word: String, deleted: Boolean) =
        record(context, "personal_word", language, word, null, deleted)

    fun recordCorrection(context: Context, language: String, source: String, preferred: String?, deleted: Boolean) =
        record(context, "correction", language, source, preferred, deleted)

    fun recordShortcut(context: Context, language: String, source: String, preferred: String?, deleted: Boolean) =
        record(context, "shortcut", language, source, preferred, deleted)

    private fun record(
        context: Context,
        type: String,
        language: String,
        source: String,
        preferred: String?,
        deleted: Boolean
    ) {
        val cleanSource = source.trim()
        if (cleanSource.isBlank()) return
        val entry = Entry(
            entryKey = entryKey(type, language, cleanSource),
            entryType = type,
            language = language,
            source = cleanSource,
            preferred = preferred?.trim()?.takeIf { it.isNotBlank() },
            deleted = deleted,
            clientUpdatedAt = Instant.now().toString()
        )
        synchronized(lock) {
            val pending = readPending(context).toMutableMap()
            pending[entry.entryKey] = entry
            writePending(context, pending)
            scheduled?.cancel(false)
            if (AnaAccountSync.isSignedIn(context)) {
                val app = context.applicationContext
                scheduled = scheduler.schedule({
                    runCatching { AnaAccountSync.syncNow(app) }
                }, 2, TimeUnit.SECONDS)
            }
        }
    }

    @Synchronized
    fun syncNow(context: Context, session: AnaAccountSync.Session): AnaAccountSync.SyncSummary {
        val app = context.applicationContext
        val prefs = app.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val previouslyBound = prefs.getString(KEY_BOUND_USER, "").orEmpty()

        if (previouslyBound.isNotBlank() && previouslyBound != session.userId) {
            // Prevent data from one Ana account being uploaded into another.
            writePending(app, emptyMap())
            KeyboardPrefs.clearAllSyncedLearning(app)
        }

        val remote = AnaAccountSync.fetchLearning(session)
        val remoteByKey = remote.associateBy { it.entryKey }.toMutableMap()
        var pending = readPending(app).toMutableMap()

        if (previouslyBound.isBlank()) {
            // First sign-in on an existing installation: preserve and upload the
            // user's pre-account local dictionary instead of throwing it away.
            snapshotLocal(app).forEach { local ->
                if (local.entryKey !in remoteByKey && local.entryKey !in pending) {
                    pending[local.entryKey] = local
                }
            }
        }

        // Last-writer-wins using the explicit client timestamp. A newer remote
        // edit is never overwritten merely because this device happened to sync.
        val iterator = pending.iterator()
        while (iterator.hasNext()) {
            val (key, local) = iterator.next()
            val cloud = remoteByKey[key] ?: continue
            if (instant(cloud.clientUpdatedAt) >= instant(local.clientUpdatedAt)) {
                iterator.remove()
            }
        }

        if (pending.isNotEmpty()) {
            AnaAccountSync.upsertLearning(session, pending.values)
        }

        val finalRemote = AnaAccountSync.fetchLearning(session)
        finalRemote.sortedBy { instant(it.clientUpdatedAt) }.forEach { applyRemote(app, it) }
        KeyboardPrefs.setSharedGlossary(app, AnaAccountSync.fetchSharedGlossary(session))

        writePending(app, emptyMap())
        prefs.edit().putString(KEY_BOUND_USER, session.userId).apply()
        return AnaAccountSync.SyncSummary(
            email = session.email,
            uploaded = pending.size,
            remoteEntries = finalRemote.count { !it.deleted }
        )
    }

    private fun snapshotLocal(context: Context): List<Entry> {
        val now = Instant.now().toString()
        return buildList {
            listOf("EN", "DE", "HIN").forEach { language ->
                KeyboardPrefs.personalDictionary(context, language).forEach { word ->
                    add(Entry(entryKey("personal_word", language, word), "personal_word", language, word, null, false, now))
                }
                KeyboardPrefs.learnedCorrections(context, language).forEach { (source, preferred) ->
                    add(Entry(entryKey("correction", language, source), "correction", language, source, preferred, false, now))
                }
                KeyboardPrefs.textShortcuts(context, language).forEach { (source, preferred) ->
                    add(Entry(entryKey("shortcut", language, source), "shortcut", language, source, preferred, false, now))
                }
            }
        }
    }

    private fun applyRemote(context: Context, entry: Entry) {
        when (entry.entryType) {
            "personal_word" -> {
                if (entry.deleted) KeyboardPrefs.removePersonalWord(context, entry.source, entry.language, false)
                else KeyboardPrefs.addPersonalWord(context, entry.source, entry.language, false)
            }
            "correction" -> {
                if (entry.deleted) KeyboardPrefs.removeLearnedCorrection(context, entry.source, entry.language, false)
                else entry.preferred?.let { KeyboardPrefs.learnCorrection(context, entry.source, it, entry.language, false) }
            }
            "shortcut" -> {
                if (entry.deleted) KeyboardPrefs.removeTextShortcut(context, entry.source, entry.language, false)
                else entry.preferred?.let { KeyboardPrefs.setTextShortcut(context, entry.source, it, entry.language, false) }
            }
        }
    }

    private fun entryKey(type: String, language: String, source: String): String {
        val normalized = source.trim().lowercase()
        val encoded = Base64.encodeToString(
            normalized.toByteArray(Charsets.UTF_8),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
        return "$type|$language|$encoded"
    }

    private fun readPending(context: Context): Map<String, Entry> {
        val raw = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
            .getString(KEY_PENDING, "{}").orEmpty()
        return try {
            val json = JSONObject(raw.ifBlank { "{}" })
            buildMap {
                val keys = json.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    Entry.fromJson(json.optJSONObject(key))?.let { put(key, it) }
                }
            }
        } catch (_: Exception) {
            emptyMap()
        }
    }

    private fun writePending(context: Context, values: Map<String, Entry>) {
        val json = JSONObject()
        values.forEach { (key, value) -> json.put(key, value.toJson()) }
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
            .edit().putString(KEY_PENDING, json.toString()).apply()
    }

    private fun instant(value: String): Instant = try {
        Instant.parse(value)
    } catch (_: Exception) {
        Instant.EPOCH
    }
}
