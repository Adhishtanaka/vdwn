const { spawn, exec } = require("child_process");
const cliProgress = require("cli-progress");
const execAsync = require("util").promisify(exec);
const { join } = require("./utils");

class ThrottledProgressBar
{
    constructor(progressBar, throttleMs = 3000)
    {
        this.progressBar = progressBar;
        this.throttleMs = throttleMs;
        this.lastUpdate = 0;
        this.pendingUpdate = null;
    }

    update(progress, payload)
    {
        const now = Date.now();
        if (now - this.lastUpdate >= this.throttleMs)
        {
            this.progressBar.update(progress, payload);
            this.lastUpdate = now;
            if (this.pendingUpdate)
            {
                clearTimeout(this.pendingUpdate);
                this.pendingUpdate = null;
            }
        } else
        {
            if (this.pendingUpdate)
            {
                clearTimeout(this.pendingUpdate);
            }
            this.pendingUpdate = setTimeout(() =>
            {
                this.progressBar.update(progress, payload);
                this.lastUpdate = Date.now();
                this.pendingUpdate = null;
            }, this.throttleMs - (now - this.lastUpdate));
        }
    }

    start(...args)
    {
        return this.progressBar.start(...args);
    }

    stop()
    {
        if (this.pendingUpdate)
        {
            clearTimeout(this.pendingUpdate);
            this.pendingUpdate = null;
        }
        return this.progressBar.stop();
    }
}

async function downloadO(answers, setCurrentProcess, isCancelled)
{

    try
    {
        const url = answers.url;
        const outputDir = answers.output;
        const urlObj = new URL(url);
        let filename = urlObj.pathname.split("/").pop() || "output";
        filename = filename.split("?")[0];
        if (!filename.match(/\.(mp4|mkv|webm|mp3|mov|avi)$/i))
        {
            filename += (answers.downloadType && answers.downloadType === "audio-only") ? ".mp3" : ".mp4";
        }
        const outputPath = join(outputDir, filename);

        const { existsSync, statSync } = require("fs");
        const { basename } = require("path");
        const colors = require("./utils").colors;
        let finalOutputPath = outputPath;
        const origFilename = filename;
        let fileIndex = 1;
        if (existsSync(finalOutputPath))
        {
            const stats = statSync(finalOutputPath);
            const fileSize = (stats.size / (1024 * 1024)).toFixed(2);
            console.log(colors.yellow(`\n File already exists: ${basename(finalOutputPath)}`));
            console.log(colors.gray(`   Size: ${fileSize} MB`));
            console.log(colors.gray(`   Modified: ${stats.mtime.toLocaleString()}`));
            console.log();
            const inquirer = require("inquirer");
            const { action } = await inquirer.prompt([
                {
                    type: "list",
                    name: "action",
                    message: "What would you like to do?",
                    choices: [
                        { name: "Overwrite existing file", value: "overwrite" },
                        { name: "Download with new name", value: "newname" },
                        { name: "Skip this download", value: "skip" }
                    ]
                }
            ]);
            if (action === "skip")
            {
                console.log(colors.yellow("Skipping download as requested."));
                return null;
            }
            if (action === "newname")
            {
                const ext = origFilename.includes('.') ? origFilename.substring(origFilename.lastIndexOf('.')) : '';
                const base = origFilename.replace(ext, '');
                do
                {
                    filename = `${base} (${fileIndex})${ext}`;
                    finalOutputPath = join(outputDir, filename);
                    fileIndex++;
                } while (existsSync(finalOutputPath));
                console.log();
                console.log(colors.yellow(`\n Downloading as: ${filename}`));
            }
        }

        const getDuration = async () =>
        {
            try
            {
                const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}"`);
                return parseFloat(stdout.trim());
            } catch (error)
            {
                console.log(colors.yellow(`[WARNING] Could not determine video duration: ${error.message}`));
                return null;
            }
        };

        const totalDuration = await getDuration();
        const progressBar = new cliProgress.SingleBar({
            format: function (options, params, payload)
            {
                let percent;
                if (typeof params.percentage === 'number' && !isNaN(params.percentage))
                {
                    percent = params.percentage;
                } else if (typeof params.value === 'number' && typeof params.total === 'number' && params.total > 0)
                {
                    percent = Math.round((params.value / params.total) * 100);
                } else if (typeof params.progress === 'number')
                {
                    percent = Math.round(params.progress * 100);
                } else
                {
                    percent = '??';
                }
                const bar = colors.cyan(options.barCompleteString.substr(0, Math.round(params.progress * options.barsize)) +
                    options.barIncompleteString.substr(0, options.barsize - Math.round(params.progress * options.barsize)));
                return `[VIDEO] |${bar}| ${percent}% | ETA: ${payload.eta} | Speed: ${payload.speed}`;
            },
            barCompleteChar: "\u2588",
            barIncompleteChar: "\u2591",
            hideCursor: true
        });

        const throttledBar = new ThrottledProgressBar(progressBar, 3000);

        // Cross-platform process kill helper
        function killProcessTree(proc)
        {
            if (!proc || proc.killed) {return;}
            const pid = proc.pid;
            if (process.platform === 'win32')
            {
                // Use taskkill to kill process tree
                require('child_process').execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
            } else
            {
                // POSIX: kill process group
                try
                {
                    process.kill(-pid, 'SIGKILL');
                } catch (e)
                {
                    try { proc.kill('SIGKILL'); } catch (e2) { }
                }
            }
        }

        let cancelHandled = false;
        return new Promise((resolve, reject) =>
        {
            const startTime = Date.now();
            let lastUpdateTime = startTime;
            let totalBytes = 0;
            let lastPercentValue = 0;
            throttledBar.start(100, 0, {
                eta: "Calculating...",
                speed: "0 KB/s"
            });

            const spawnOpts = process.platform !== 'win32' ? { detached: true } : {};
            const ffmpeg = spawn("ffmpeg", [
                "-i", url,
                ...(answers.downloadType && answers.downloadType === "audio-only" ? ["-vn", "-acodec", "copy"] : ["-c", "copy"]),
                "-progress", "pipe:2",
                "-nostats",
                "-loglevel", "error",
                "-y",
                finalOutputPath
            ], spawnOpts);

            setCurrentProcess({
                proc: ffmpeg,
                kill: () =>
                {
                    if (!cancelHandled)
                    {
                        cancelHandled = true;
                        killProcessTree(ffmpeg);
                    }
                }
            });

            let buffer = "";
            const progressData = {};

            ffmpeg.stderr.on("data", data =>
            {
                if (isCancelled() && !cancelHandled)
                {
                    cancelHandled = true;
                    throttledBar.stop();
                    killProcessTree(ffmpeg);
                    return;
                }
                buffer += data.toString();
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop();
                for (const line of lines)
                {
                    const [key, value] = line.split("=");
                    if (key && value !== undefined)
                    {
                        progressData[key.trim()] = value.trim();
                    }
                }

                const now = Date.now();
                if (progressData["out_time_ms"] || progressData["out_time"] || progressData["total_size"])
                {
                    let seconds = 0;
                    if (progressData["out_time_ms"])
                    {
                        seconds = parseInt(progressData["out_time_ms"]) / 1000000;
                    } else if (progressData["out_time"])
                    {
                        const t = progressData["out_time"].split(":").reverse();
                        if (t.length === 3) { seconds = (+t[2]) * 3600 + (+t[1]) * 60 + (+t[0]); }
                        else if (t.length === 2) { seconds = (+t[1]) * 60 + (+t[0]); }
                        else { seconds = +t[0]; }
                    }
                    if (progressData["total_size"])
                    {
                        totalBytes = parseInt(progressData["total_size"]);
                    }
                    let percent;
                    if (typeof totalDuration === 'number' && !isNaN(totalDuration) && totalDuration > 0)
                    {
                        percent = Math.min(100, Math.round((seconds / totalDuration) * 100));
                    } else if (typeof seconds === 'number' && seconds > 0)
                    {
                        percent = Math.min(100, Math.round((seconds / (seconds + 1)) * 100));
                    } else
                    {
                        percent = lastPercentValue;
                    }
                    if (typeof percent === 'number' && percent > lastPercentValue) { lastPercentValue = percent; }
                    const elapsed = (now - startTime) / 1000;
                    const speed = totalBytes > 0 && elapsed > 0 ? (totalBytes / 1024 / elapsed).toFixed(1) + " KB/s" : "-";
                    const eta = (typeof totalDuration === 'number' && !isNaN(totalDuration) && totalDuration > 0 && seconds > 0)
                        ? Math.max(0, Math.round((totalDuration - seconds) / (seconds / elapsed))) + "s"
                        : "Unknown";
                    if (now - lastUpdateTime >= 3000 || percent === 100)
                    {
                        lastUpdateTime = now;
                        throttledBar.update(percent, {
                            eta: eta,
                            speed: speed,
                            percentage: percent
                        });
                    }
                }
            });

            ffmpeg.on("close", code =>
            {
                setCurrentProcess(null);
                progressBar.update(100, { eta: "Complete", speed: "-", percentage: 100 });
                throttledBar.update(100, {
                    eta: "Complete",
                    speed: "-",
                    percentage: 100
                });
                throttledBar.stop();
                if (cancelHandled)
                {
                    return reject(new Error("Download operation was cancelled by user"));
                }
                if (code === 0)
                {
                    console.log();
                    console.log(colors.green(`[SUCCESS] Download completed: ${filename}`));
                    resolve();
                } else
                {
                    reject(new Error(`FFmpeg process failed with exit code ${code}`));
                }
            });

            ffmpeg.on("error", err =>
            {
                setCurrentProcess(null);
                throttledBar.stop();
                reject(new Error(`Failed to start FFmpeg process: ${err.message}`));
            });
        });
    } catch (error)
    {
        throw new Error(`Download failed: ${error.message}`);
    }
}

async function downloadY(answers, setCurrentProcess, setProgressBars, isCancelled)
{

    try
    {
        const { getFormatSelector } = require("./utils");
        const formatSelector = getFormatSelector(answers);
        const outputTemplate = join(answers.output, "%(title)s.%(ext)s");

        const { existsSync, statSync } = require("fs");
        const { basename } = require("path");
        const colors = require("./utils").colors;
        const execAsync = require("util").promisify(require("child_process").exec);
        let outputFilename = null;
        try
        {
            const { stdout } = await execAsync(`yt-dlp --get-filename --output \"%(title)s.%(ext)s\" \"${answers.url}\"`);
            outputFilename = stdout.trim();
        } catch (e)
        {

        }
        let finalOutputPath = null;
        let filename = null;
        let fileIndex = 1;
        if (outputFilename)
        {
            filename = outputFilename;
            finalOutputPath = join(answers.output, filename);
            if (existsSync(finalOutputPath))
            {
                const stats = statSync(finalOutputPath);
                const fileSize = (stats.size / (1024 * 1024)).toFixed(2);
                console.log(colors.yellow(`\n File already exists: ${basename(finalOutputPath)}`));
                console.log(colors.gray(`   Size: ${fileSize} MB`));
                console.log(colors.gray(`   Modified: ${stats.mtime.toLocaleString()}`));
                console.log();
                const inquirer = require("inquirer");
                const { action } = await inquirer.prompt([
                    {
                        type: "list",
                        name: "action",
                        message: "What would you like to do?",
                        choices: [
                            { name: "Overwrite existing file", value: "overwrite" },
                            { name: "Download with new name", value: "newname" },
                            { name: "Skip this download", value: "skip" }
                        ]
                    }
                ]);
                if (action === "skip")
                {
                    console.log(colors.yellow("Skipping download as requested."));
                    return null;
                }
                if (action === "newname")
                {
                    const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
                    const base = filename.replace(ext, '');
                    do
                    {
                        filename = `${base} (${fileIndex})${ext}`;
                        finalOutputPath = join(answers.output, filename);
                        fileIndex++;
                    } while (existsSync(finalOutputPath));
                    console.log();
                    console.log(colors.yellow(`\n Downloading as: ${filename}`));
                }
            }
        }

        const progressBar = new cliProgress.SingleBar({
            format: function (options, params, payload)
            {
                const color = payload.phase === 'audio' ? colors.yellow : colors.cyan;
                const percent = typeof params.value === 'number' && !isNaN(params.value) ? params.value : 0;
                const bar = color(options.barCompleteString.substr(0, Math.round(params.progress * options.barsize)) +
                    options.barIncompleteString.substr(0, options.barsize - Math.round(params.progress * options.barsize)));
                return `[${payload.phase.toUpperCase()}] |${bar}| ${percent}% | Speed: ${payload.speed} | ETA: ${payload.eta}`;
            },
            barCompleteChar: "\u2588",
            barIncompleteChar: "\u2591",
            hideCursor: true,
            barsize: 40
        });

        const throttledBar = new ThrottledProgressBar(progressBar);
        setProgressBars({ stop: () => throttledBar.stop() });

        const args = [
            "--format", formatSelector,
            "--output", finalOutputPath ? finalOutputPath : outputTemplate,
            "--progress",
            "--newline",
            answers.url
        ];

        if (answers.downloadType === "audio-only")
        {
            args.push("--extract-audio", "--audio-format", "mp3");
        }

        // Cross-platform process kill helper
        function killProcessTree(proc)
        {
            if (!proc || proc.killed) {return;}
            const pid = proc.pid;
            if (process.platform === 'win32')
            {
                require('child_process').execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
            } else
            {
                try
                {
                    process.kill(-pid, 'SIGKILL');
                } catch (e)
                {
                    try { proc.kill('SIGKILL'); } catch (e2) { }
                }
            }
        }

        let cancelHandled = false;
        return new Promise((resolve, reject) =>
        {
            const spawnOpts = process.platform !== 'win32' ? { detached: true } : {};
            const ytdlp = spawn("yt-dlp", args, spawnOpts);
            setCurrentProcess({
                proc: ytdlp,
                kill: () =>
                {
                    if (!cancelHandled)
                    {
                        cancelHandled = true;
                        killProcessTree(ytdlp);
                    }
                }
            });

            let currentPhase = answers.downloadType === "audio-only" ? "audio" : "video";
            let buffer = "";
            let lastProgress = -1;

            throttledBar.start(100, 0, {
                phase: currentPhase,
                speed: "0KB/s",
                eta: "Unknown"
            });

            ytdlp.stdout.on("data", data =>
            {
                if (isCancelled() && !cancelHandled)
                {
                    cancelHandled = true;
                    throttledBar.stop();
                    killProcessTree(ytdlp);
                    return;
                }

                buffer += data.toString();
                const lines = buffer.split("\n");
                buffer = lines.pop();

                for (const line of lines)
                {
                    if (!line.trim()) {continue;}

                    if (line.includes("audio only") || line.includes(".m4a") || line.includes("Extracting audio"))
                    {
                        if (currentPhase !== "audio")
                        {
                            currentPhase = "audio";
                            console.log(colors.yellow("\n[INFO] Switching to audio processing phase"));
                        }
                    }

                    if (line.includes("[download]") && line.includes("%"))
                    {
                        const progressMatch = line.match(/\[download\]\s+([0-9.]+)%\s+of\s+([0-9.]+(?:KiB|MiB|GiB))\s+at\s+([0-9.]+(?:\.[0-9]+)?(?:KiB|MiB|GiB))\/s(?:\s+ETA\s+([0-9:]+))?/);

                        if (progressMatch)
                        {
                            const percent = parseFloat(progressMatch[1]);
                            const speed = progressMatch[3];
                            const eta = progressMatch[4] || "Unknown";

                            if (Math.round(percent) !== lastProgress)
                            {
                                lastProgress = Math.round(percent);
                                throttledBar.update(percent, {
                                    phase: currentPhase,
                                    speed: speed + "/s",
                                    eta: eta
                                });
                            }
                        }
                    }

                    if (line.includes("[download] 100%"))
                    {
                        throttledBar.update(100, {
                            phase: currentPhase,
                            speed: "",
                            eta: ""
                        });
                    }

                    if (line.includes("[ExtractAudio]") || line.includes("Extracting audio"))
                    {
                        throttledBar.update(100, {
                            phase: "audio",
                            speed: "",
                            eta: ""
                        });
                    }
                }
            });

            ytdlp.stderr.on("data", data =>
            {
                const errorOutput = data.toString();
                if (!errorOutput.includes("WARNING") && !errorOutput.includes("[download]"))
                {
                    console.error(colors.red(`[ERROR] ${errorOutput.trim()}`));
                }
            });

            ytdlp.on("close", code =>
            {
                setCurrentProcess(null);

                if (cancelHandled)
                {
                    throttledBar.stop();
                    return reject(new Error("Download operation was cancelled by user"));
                }

                throttledBar.update(100, {
                    phase: currentPhase,
                    speed: "",
                    eta: ""
                });
                progressBar.update(100);
                throttledBar.stop();

                if (code === 0)
                {
                    console.log();
                    console.log(colors.green("\n[SUCCESS] Download completed successfully"));
                    resolve();
                } else
                {
                    reject(new Error(`yt-dlp process failed with exit code ${code}`));
                }
            });

            ytdlp.on("error", error =>
            {
                setCurrentProcess(null);
                throttledBar.stop();
                reject(new Error(`Failed to start yt-dlp process: ${error.message}`));
            });
        });
    } catch (error)
    {
        throw new Error(`YouTube download failed: ${error.message}`);
    }
}

module.exports = {
    downloadO,
    downloadY
};