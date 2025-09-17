const colors = require("ansi-colors");
const execAsync = require("util").promisify(require("child_process").exec);

async function ensureDependencies() {  
  const deps = [
    { name: "ffmpeg", versionCmd: "-version" },
    { name: "yt-dlp", versionCmd: "--version" }
  ];
  
  const missing = [];
  
  await Promise.all(deps.map(async dep => {
    try {
      await execAsync(`${dep.name} ${dep.versionCmd}`);
    } catch (error) {
      console.log(colors.red(`[MISSING] ${dep.name} not found`));
      missing.push(dep.name);
    }
  }));

  if (missing.length) {
    console.log(colors.yellow(`[INFO] Installing missing dependencies: ${missing.join(", ")}`));
    await installDependencies(missing);
  } 
}

async function installDependencies(missingDeps) {
  const platform = process.platform;
  
  try {
    if (platform === "win32") {
      await installWithWindows(missingDeps);
    } else if (platform === "darwin") {
      await installWithBrew(missingDeps);
    } else if (platform === "linux") {
      await installWithLinux(missingDeps);
    } else {
      throw new Error(`Unsupported operating system: ${platform}`);
    }
  } catch (error) {
    throw new Error(`Dependency installation failed: ${error.message}`);
  }
}

async function installWithLinux(deps) {
  const packageManagers = [
    { name: "apt", check: "apt --version", install: "apt-get install -y" },
    { name: "dnf", check: "dnf --version", install: "dnf install -y" },
    { name: "pacman", check: "pacman --version", install: "pacman -S --noconfirm" }
  ];

  let availableManager = null;
  
  for (const pm of packageManagers) {
    try {
      await execAsync(pm.check);
      availableManager = pm;
      console.log(colors.blue(`[INFO] Using ${pm.name} package manager`));
      break;
    } catch {
      continue;
    }
  }

  if (!availableManager) {
    throw new Error("No supported package manager found. Please install dependencies manually.");
  }

  for (const dep of deps) {
    console.log(colors.blue(`[INFO] Installing ${dep} via ${availableManager.name}...`));
    const prefix = process.getuid && process.getuid() !== 0 ? "sudo " : "";
    
    try {
      if (availableManager.name === "apt") {
        await execAsync(`${prefix}apt-get update`);
      }
      await execAsync(`${prefix}${availableManager.install} ${dep}`);
      console.log(colors.green(`[SUCCESS] ${dep} installed successfully`));
    } catch (error) {
      console.log(colors.yellow(`[WARNING] Failed to install ${dep} with ${availableManager.name}, trying alternative methods...`));
      
      if (dep === "yt-dlp") {
        try {
          await execAsync(`${prefix}pip3 install yt-dlp`);
          console.log(colors.green(`[SUCCESS] ${dep} installed via pip3`));
        } catch (pipError) {
          throw new Error(`Failed to install ${dep} via both package manager and pip3: ${pipError.message}`);
        }
      } else {
        throw error;
      }
    }
  }
}

async function installWithBrew(deps) {
  try {
    await execAsync("brew --version");
    console.log(colors.blue("[INFO] Using Homebrew package manager"));
  } catch (error) {
    throw new Error("Homebrew is not installed. Please install Homebrew first from: https://brew.sh/");
  }

  for (const dep of deps) {
    console.log(colors.blue(`[INFO] Installing ${dep} via Homebrew...`));
    try {
      await execAsync(`brew install ${dep}`);
      console.log(colors.green(`[SUCCESS] ${dep} installed successfully`));
    } catch (error) {
      throw new Error(`Failed to install ${dep} via Homebrew: ${error.message}`);
    }
  }
}

async function installWithWindows(deps) {
  console.log(colors.blue("[INFO] Attempting installation using Windows Package Manager (winget)"));
  
  try {
    await execAsync("winget --version");
    console.log(colors.blue("[INFO] Windows Package Manager found"));
    await installWithWinget(deps);
  } catch (error) {
    throw new Error("Windows Package Manager (winget) is not available. Please ensure you are running Windows 10 (version 1709 or later) or Windows 11, and install winget from the Microsoft Store (App Installer).");
  }
}

async function installWithWinget(deps) {
  const wingetMap = {
    "ffmpeg": "Gyan.FFmpeg",
    "yt-dlp": "yt-dlp.yt-dlp"
  };

  for (const dep of deps) {
    const packageName = wingetMap[dep];
    if (!packageName) {
      throw new Error(`No winget package mapping found for ${dep}`);
    }

    console.log(colors.blue(`[INFO] Installing ${dep} (${packageName}) via winget...`));
    
    try {
      await execAsync(`winget install --id ${packageName} --accept-source-agreements --accept-package-agreements --silent`, { timeout: 600000 });
      console.log(colors.green(`[SUCCESS] ${dep} installed successfully`));
    } catch (error) {
      console.log(colors.yellow(`[WARNING] Retrying ${dep} installation with alternative parameters...`));
      
      try {
        await execAsync(`winget install ${packageName} -e --accept-source-agreements --accept-package-agreements`, { timeout: 600000 });
        console.log(colors.green(`[SUCCESS] ${dep} installed successfully on retry`));
      } catch (retryError) {
        throw new Error(`Failed to install ${dep} with winget. Error: ${retryError.message}\n\nYou can try installing manually with: winget install ${packageName}`);
      }
    }
  }

  console.log(colors.green("\n[SUCCESS] All dependencies installed successfully"));
  console.log(colors.yellow("[INFO] You may need to restart your terminal for PATH changes to take effect"));
}

module.exports = {
  ensureDependencies
};