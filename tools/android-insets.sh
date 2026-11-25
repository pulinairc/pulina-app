#!/bin/sh
# Keep the page between Android's status and navigation bars and above the keyboard. Tauri's
# generated activity draws edge to edge, and the web view gets no safe-area values on Android,
# so the bars covered the header and the message box. Run after `tauri android init`.
set -eu
main=$(find src-tauri/gen/android/app/src/main -name MainActivity.kt | head -n1)
package=$(sed -n 's/^package //p' "$main")
# The page's own background, so the bars sit on the same colour as the app.
bg=$( (cat ui/style.css ui/brand.css) | sed -n 's/^ *--bg: *\(#[0-9a-fA-F]\{6\}\);.*/\1/p' | tail -n1)
cat > "$main" <<KT
package $package

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
    val content = findViewById<View>(android.R.id.content)
    content.setBackgroundColor(Color.parseColor("$bg"))
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }
}
KT
echo "$main: insets applied, bars on $bg"
