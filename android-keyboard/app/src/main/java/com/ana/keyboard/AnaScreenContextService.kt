package com.ana.keyboard

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * User-enabled accessibility bridge. Reads visible text only when Reply is tapped.
 * Does not persist, log or upload screen contents by itself.
 */
class AnaScreenContextService : AccessibilityService() {
    companion object {
        @Volatile private var active: AnaScreenContextService? = null

        fun visibleText(requestingPackage: String): String? {
            val service = active ?: return null
            if (requestingPackage.isBlank() || requestingPackage == "com.ana.keyboard") return null
            if (service.packageName == requestingPackage) return null
            val root = service.rootInActiveWindow ?: return null
            if (root.packageName?.toString() != requestingPackage) return null
            val collected = mutableListOf<String>()
            fun walk(node: AccessibilityNodeInfo, depth: Int) {
                if (depth > 20 || collected.size >= 60) return
                if (node.isPassword || node.isEditable) return
                val text = node.text?.toString()?.trim().orEmpty()
                if (text.length in 2..1000 && text !in collected) collected.add(text)
                for (i in 0 until minOf(node.childCount, 35)) {
                    node.getChild(i)?.let { walk(it, depth + 1) }
                }
            }
            walk(root, 0)
            return collected.joinToString("\n").takeLast(6000).takeIf { it.isNotBlank() }
        }

        fun isConnected(): Boolean = active != null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        active = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Deliberately do nothing. Ana only reads on an explicit Reply action.
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (active === this) active = null
        super.onDestroy()
    }
}
