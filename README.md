# Budpack (For SweedPOS)

Budpack is a cross-platform desktop application built with Tauri, Rust, and React. It is designed to automate the tedious process of weekly inventory directly into Sweed's Inventory Purchase system. 

Budpack mimics human interaction to safely and accurately inject external track code, barcode ID, and expiration dates into the Sweed UI.

## How it Works

* **Excel Parsing:** Reads an `.xlsx` inventory prep file and parses the data.
* **Automated Data Entry:** Uses a hybrid approach of JavaScript DOM manipulation and synthetic event dispatching.
* **Pause in Background** Budpack will pause if you navigate away from the window.
* **Full Order Input:** Processes one row per 5 seconds, turning an hours long task into a 5 minute coffee break.
* **Finish Prep Sheet** Fill empty fields on prep sheet before importing.

## Features

* **Cross-Platform:** Built on Tauri v2, ensuring lightweight, native execution on Windows, macOS, and Linux.
* **Auto-Updater:** Built-in updater  pulls the latest signed binaries directly from GitHub Releases.

## Installation & Setup

1. Get the latest version from [https://github.com/ryanorlando92/budpack/releases/latest](https://github.com/ryanorlando92/budpack/releases/latest)

* VERANO COMPUTERS MUST USE `budpack-x.x.x_x64-setup.exe` THIS WILL INSTALL INTO YOUR APPDATA FOLDER BY DEFAULT AND WILL NOT REQUIRE AN ADMIN PASSWORD

2. Install the package

Thats it! Yes it's that easy.

## Known Issues


## Roadmap / Planned Features
I am actively working to make Budpack more robust and feature-rich. The following updates are planned:

[ ] In-App Documentation: A "Readme" button directly in the UI to easily access instructions and troubleshooting steps.

