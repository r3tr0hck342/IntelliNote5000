#!/bin/bash
set -e

# Load nvm if using Node via nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Ensure Cargo bin path is available
export PATH="$HOME/.cargo/bin:$PATH"

prompt_install() {
    read -rp "→ Install now? [y/N] " answer
    case "$answer" in
        [Yy]*) eval "$1" ;;
        *) echo "⏭ Skipped." ;;
    esac
}

echo "== Checking Node.js version =="
if node -v | grep "v20" >/dev/null; then
    echo "✅ Node 20 installed"
else
    echo "❌ Node 20 not found"
fi

echo "== Checking npm version =="
if npm -v | grep "^10" >/dev/null; then
    echo "✅ npm 10 installed"
else
    echo "❌ npm 10 not found"
fi

echo "== Checking Apple Developer Membership =="
if security find-identity -p codesigning -v | grep "Apple Development" >/dev/null; then
    echo "✅ Apple Developer identity found"
else
    echo "❌ Apple Developer cert not found"
fi

echo "== Checking Xcode install and selection =="
if [ -d "/Applications/Xcode.app" ]; then
    current_path=$(xcode-select -p)
    if [[ "$current_path" != "/Applications/Xcode.app/Contents/Developer" ]]; then
        echo "⚠️ Xcode is installed but not selected as active developer dir."
        echo "Setting it now..."
        sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
    fi
    xcodebuild -version && echo "✅ Xcode is installed and selected correctly"
else
    echo "❌ Xcode not found at /Applications/Xcode.app"
fi

echo "== Checking Rust toolchain =="
if command -v rustc >/dev/null; then
    rustc --version && echo "✅ Rust installed"
else
    echo "❌ Rust not found"
fi

echo "== Checking tauri-cli (cargo-tauri) =="
if cargo tauri --version >/dev/null 2>&1; then
    echo "✅ tauri-cli available via cargo"
else
    echo "❌ cargo-tauri not found"
    echo "→ Will install with: cargo install tauri-cli"
    prompt_install "cargo install tauri-cli"
fi

echo "== Checking Ruby and CocoaPods =="
if command -v gem >/dev/null; then
    echo "✅ RubyGems available"

    if command -v pod >/dev/null; then
        echo "✅ CocoaPods installed"
    elif [ -x "/usr/local/lib/ruby/gems/3.4.0/bin/pod" ]; then
        echo "✅ CocoaPods installed (via RubyGems in /usr/local)"
        export PATH="/usr/local/lib/ruby/gems/3.4.0/bin:$PATH"
    elif [ -x "$HOME/.gem/ruby/3.4.0/bin/pod" ]; then
        echo "✅ CocoaPods installed (via user RubyGems)"
        export PATH="$HOME/.gem/ruby/3.4.0/bin:$PATH"
    else
        echo "❌ CocoaPods not found"
        echo "→ Will install with: sudo gem install cocoapods"
        prompt_install "sudo gem install cocoapods"
    fi
else
    echo "❌ RubyGems not found. Consider installing Ruby via: brew install ruby"
fi

echo "== Checking for Gemini API key =="
if [ -n "$GEMINI_API_KEY" ]; then
    echo "✅ Gemini API key set in environment"
else
    echo "❌ Gemini API key not set (env var GEMINI_API_KEY missing)"
    echo '→ Add this to your shell profile:'
    echo '   export GEMINI_API_KEY="your-api-key"'
fi
