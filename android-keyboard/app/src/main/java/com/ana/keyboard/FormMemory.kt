package com.ana.keyboard

import android.content.Context
import android.view.inputmethod.EditorInfo
import org.json.JSONArray

/** Local, opt-in form completion. Never records passwords or unclassified fields. */
object FormMemory {
    fun category(info: EditorInfo?): String? {
        if (info == null) return null
        val hint = listOfNotNull(info.hintText?.toString(), info.label?.toString(), info.fieldName)
            .joinToString(" ").lowercase()
        return when {
            Regex("""\b(postleitzahl|plz|postal[ -]?code|zip[ -]?code)\b""").containsMatchIn(hint) -> "postcode"
            Regex("""\b(straße|strasse|street|address[ -]?line|anschrift)\b""").containsMatchIn(hint) -> "street"
            Regex("""\b(stadt|city|ort|wohnort|town)\b""").containsMatchIn(hint) -> "city"
            else -> null
        }
    }

    fun enabled(context: Context): Boolean =
        context.getSharedPreferences("ana_form_memory", Context.MODE_PRIVATE)
            .getBoolean("enabled", false)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences("ana_form_memory", Context.MODE_PRIVATE)
            .edit().putBoolean("enabled", enabled).apply()
    }

    fun clear(context: Context) {
        context.getSharedPreferences("ana_form_memory", Context.MODE_PRIVATE).edit().clear().apply()
    }

    private fun values(context: Context, category: String): List<String> {
        val raw = context.getSharedPreferences("ana_form_memory", Context.MODE_PRIVATE)
            .getString("values_$category", "[]") ?: "[]"
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { arr.optString(it).takeIf(String::isNotBlank) }
        } catch (_: Exception) { emptyList() }
    }

    fun suggestions(context: Context, category: String, prefix: String): List<String> {
        if (!enabled(context)) return emptyList()
        return values(context, category).filter { it.startsWith(prefix, ignoreCase = true) }.take(3)
    }

    fun remember(context: Context, category: String, value: String) {
        if (!enabled(context)) return
        val clean = value.trim().replace(Regex("""\s+"""), " ")
        if (clean.length !in 2..120 || clean.contains('@') || clean.contains('\n')) return
        if (category == "postcode" && !clean.matches(Regex("""[A-Za-z0-9 -]{3,12}"""))) return
        val next = (listOf(clean) + values(context, category))
            .distinctBy { it.lowercase() }.take(12)
        val array = JSONArray()
        next.forEach { array.put(it) }
        context.getSharedPreferences("ana_form_memory", Context.MODE_PRIVATE)
            .edit().putString("values_$category", array.toString()).apply()
    }
}
