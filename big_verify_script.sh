#!/bin/bash
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.cargo/bin:$PATH"

print_checklist() {
  echo "\n## ✅ SETUP VERIFICATION (INTEL MAC 2019)"
  echo "\n# 1. ACCOUNTS & TOOLING"
}

print_checklist

# Apple Developer
security find-identity -p codesigning -v | grep "Apple Development" >/dev/null && \
  echo "✅ Apple Developer certificate found" || \
  echo "❌ Apple Developer certificate missing"

# Xcode check
if [ -d "/Applications/Xcode.app" ]; then
  xcodebuild -version && echo "✅ Xcode installed"
else
  echo "❌ Xcode not installed"
fi

sudo xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1 && \
  echo "✅ Xcode license accepted" || \
  echo "❌ Accept license: sudo xcodebuild -license"

xcode-select -p | grep -q "/Applications/Xcode.app" && \
  echo "✅ CLT correctly selected" || \
  echo "❌ CLT not pointing to full Xcode (run: xcode-select --install)"

# Rust toolchain
rustc --version >/dev/null && echo "✅ Rust installed" || echo "❌ Rust not found"

# Rust targets
rustup show | grep -q aarch64-apple-darwin && rustup show | grep -q x86_64-apple-darwin && \
  echo "✅ macOS universal targets present" || \
  echo "❌ Missing rust targets: rustup target add aarch64-apple-darwin x86_64-apple-darwin"

# Tauri CLI
cargo tauri --version >/dev/null 2>&1 && \
  echo "✅ tauri-cli installed" || \
  echo "❌ Install tauri-cli: cargo install tauri-cli"

# CocoaPods
if command -v pod >/dev/null || [ -x "/usr/local/lib/ruby/gems/3.4.0/bin/pod" ]; then
  echo "✅ CocoaPods installed"
else
  echo "❌ CocoaPods not found (run: sudo gem install cocoapods)"
fi

# Android tooling
if command -v adb >/dev/null; then
  echo "⚠️ Android tooling found — not required for this setup"
else
  echo "✅ No Android tooling detected (as expected)"
fi

# Project Configuration
echo "\n# 2. PROJECT CONFIGURATION"

if [ -f .env.local ]; then
  echo "✅ .env.local exists (dev fallback)"
  if grep -q "VITE_API_KEY" .env.local >/dev/null; then
    echo "✅ VITE_API_KEY present in .env.local"
  else
    echo "ℹ️ Add VITE_API_KEY to .env.local if you want a dev fallback; runtime Settings UI will otherwise prompt the user."
  fi
else
  echo "ℹ️ .env.local not present (users will enter API keys in-app)"
fi

[ -d node_modules ] && echo "✅ node_modules installed" || echo "❌ Run 'npm install'"

# Metadata
jq -e '.name and .version' package.json >/dev/null 2>&1 && echo "✅ package.json name/version set" || echo "❌ Check package.json metadata"
jq -e '.package.productName' src-tauri/tauri.conf.json >/dev/null 2>&1 && jq -e '.tauri.bundle.identifier' src-tauri/tauri.conf.json >/dev/null 2>&1 && \
  echo "✅ tauri.conf.json productName and identifier set" || \
  echo "❌ Check .package.productName or .tauri.bundle.identifier in tauri.conf.json"
grep -q 'com.intellinote.app' capacitor.config.ts && echo "✅ Capacitor bundle ID correct" || echo "❌ Bundle ID mismatch"

# Icons
[ -d src-tauri/icons ] && echo "✅ macOS icons directory exists" || echo "❌ Missing: src-tauri/icons"

# Local Web Build

echo "\n# 3. LOCAL WEB BUILD VERIFICATION"

if [ ! -d node_modules ]; then
  echo "❌ npm install has not been run yet"
else
  npm run build >/dev/null 2>&1 && echo "✅ npm run build succeeded" || echo "❌ npm run build failed"
fi

# Markdown Summary Output

echo "\n# 4. MARKDOWN CHECKLIST"
echo "\nPaste this into PRs or team docs:"
echo ""
echo "- [$(security find-identity -p codesigning -v | grep -q 'Apple Development' && echo 'x' || echo ' ')] Apple Developer Program membership"
echo "- [$(xcodebuild -version >/dev/null 2>&1 && echo 'x' || echo ' ')] Xcode installed and license accepted"
echo "- [$(xcode-select -p | grep -q '/Applications/Xcode.app' && echo 'x' || echo ' ')] Command Line Tools set"
echo "- [$(rustc --version >/dev/null 2>&1 && rustup show | grep -q aarch64 && echo 'x' || echo ' ')] Rust + universal targets installed"
echo "- [$(cargo tauri --version >/dev/null 2>&1 && echo 'x' || echo ' ')] tauri-cli installed"
echo "- [$(command -v pod >/dev/null && echo 'x' || echo ' ')] CocoaPods installed"
echo "- [$(command -v adb >/dev/null && echo ' ' || echo 'x')] No Android tooling"
echo "- [$(test -f .env.local && echo 'x' || echo ' ')] .env.local present (optional)"
echo "- [$(test -f .env.local && grep -q VITE_API_KEY .env.local 2>/dev/null && echo 'x' || echo ' ')] VITE_API_KEY present (optional fallback)"
echo "- [$(test -d node_modules && echo 'x' || echo ' ')] npm install run"
echo "- [$(jq -e '.name and .version' package.json >/dev/null 2>&1 && echo 'x' || echo ' ')] package.json name/version"
echo "- [$(jq -e '.package.productName' src-tauri/tauri.conf.json >/dev/null 2>&1 && jq -e '.tauri.bundle.identifier' src-tauri/tauri.conf.json >/dev/null 2>&1 && echo 'x' || echo ' ')] tauri.conf.json metadata"
echo "- [$(grep -q 'com.intellinote.app' capacitor.config.ts && echo 'x' || echo ' ')] Capacitor bundle ID"
echo "- [$(test -d src-tauri/icons && echo 'x' || echo ' ')] Icons directory exists"
if [ -d node_modules ]; then
  echo "- [$(npm run build >/dev/null 2>&1 && echo 'x' || echo ' ')] Web production build"
else
  echo "- [ ] Web production build"
fi
echo ""
echo "Done. ✅"
