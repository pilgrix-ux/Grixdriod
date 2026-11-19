# GRIXDroid

**An experimental, browser-native ARM and Android runtime prototype built with Rust and WebAssembly.**

GRIXDroid explores running selected Android/Dalvik workloads locally in a browser, without a hosted Android VM or remote screen-streaming service. The emulator core and constrained APK/DEX runner execute in WebAssembly on the visitor's device.

## Current capabilities

- ARMv7-era CPU core with ARM and Thumb execution
- CP15 and a subset of short-descriptor memory management
- Emulated memory and peripheral paths, including UART, timers, interrupts, and framebuffer/VRAM
- Browser canvas rendering, touch and keyboard input
- CPU state, register, and instruction debugging
- ROM and custom hexadecimal program loading
- Experimental Linux kernel boot plumbing
- APK and DEX parsing with a small Dalvik HLE interpreter for limited workloads

## Important limitations

GRIXDroid is **not a complete Android operating system** and is not a general-purpose APK emulator. It does not provide full Android userspace, ART, zygote, Binder compatibility, SurfaceFlinger, Google Play Services, multidex support, or general JNI/native-library execution. Most ordinary Play Store APKs will not run.

The APK runner supports only a narrow subset of DEX instructions and framework calls. Treat this as a systems research prototype, not a replacement for the Android Emulator or a real Android device.

## Run locally

Requirements: Rust stable, the wasm32-unknown-unknown target, wasm-pack, and Node.js 20 or newer.

```bash
git clone https://github.com/pilgrix-ux/Grixdriod.git
cd Grixdriod
npm ci
npm run dev
```

Open the Vite URL printed in the terminal.

For a production build:

```bash
npm run build
npm run preview
```

Run Rust tests:

```bash
cargo test --locked --lib
```

The production build compiles the Rust crate to WebAssembly, then runs TypeScript checking and Vite.

## Project structure

- src/cpu.rs, src/memory.rs, src/cp15.rs: ARM CPU and memory model
- src/android/: APK/AXML/DEX parsing and constrained Dalvik HLE runtime
- src/lib.rs: WebAssembly exports
- src/main.ts, src/style.css: browser UI and rendering
- docs/: implementation notes and current support boundaries

## Attribution

GRIXDroid is an adaptation of [NekoDroid](https://github.com/nishal21/NekoDroid), created by Nishal K. The upstream project is distributed under the MIT License. The MIT license and required copyright notice are retained in LICENSE.

GRIXDroid is an independent project and is not affiliated with or endorsed by Google. Android is a trademark of Google LLC.
