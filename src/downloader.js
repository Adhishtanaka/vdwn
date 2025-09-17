// Handles download logic and progress bars
const { spawn, exec } = require("child_process");
const cliProgress = require("cli-progress");
const execAsync = require("util").promisify(exec);
const { join} = require("./utils");

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

        // Overwrite detection
        const { existsSync, statSync, basename } = require("fs");
        const colors = require("./utils").colors;
        if (existsSync(outputPath))
        {
            const stats = statSync(outputPath);
            const fileSize = (stats.size / (1024 * 1024)).toFixed(2);
            console.log(colors.yellow(`\n⚠️  File already exists: ${basename(outputPath)}`));
            console.log(colors.gray(`   Size: ${fileSize} MB`));
            console.log(colors.gray(`   Modified: ${stats.mtime.toLocaleString()}`));
            const inquirer = require("inquirer");
            const { action } = await inquirer.prompt([
                {
                    type: "list",
                    name: "action",
                    message: "What would you like to do?",
                    choices: [
                        { name: "Overwrite existing file", value: "overwrite" },
                        { name: "Skip this download", value: "skip" }
                    ]
                }
            ]);
            if (action === "skip")
            {
                console.log(colors.yellow("Skipping download as requested."));
                return;
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
                const percent = typeof params.percentage === 'number' && !isNaN(params.percentage) ? params.percentage : 0;
                const bar = colors.cyan(options.barCompleteString.substr(0, Math.round(params.progress * options.barsize)) +
                    options.barIncompleteString.substr(0, options.barsize - Math.round(params.progress * options.barsize)));
                return `[DOWNLOAD] |${bar}| ${percent}% | ${payload.currentTime}/${payload.totalTime} sec | ETA: ${payload.eta}`;
            },
            barCompleteChar: "\u2588",
            barIncompleteChar: "\u2591",
            hideCursor: true
        });

        const throttledBar = new ThrottledProgressBar(progressBar);

        return new Promise((resolve, reject) =>
        {
            let lastPercent = 0;
            throttledBar.start(100, 0, {
                currentTime: "0",
                totalTime: totalDuration ? totalDuration.toFixed(1) : "Unknown",
                eta: "Calculating..."
            });

            const ffmpeg = spawn("ffmpeg", [
                "-i", url,
                ...(answers.downloadType && answers.downloadType === "audio-only" ? ["-vn", "-acodec", "copy"] : ["-c", "copy"]),
                "-progress", "pipe:2",
                "-nostats",
                "-loglevel", "error",
                "-y",
                outputPath
            ]);

            setCurrentProcess(ffmpeg);

            ffmpeg.stderr.on("data", data =>
            {
                if (isCancelled()) return;
                const str = data.toString();
                const timeMatch = str.match(/time=([\d:.]+)/);
                if (timeMatch && totalDuration)
                {
                    const t = timeMatch[1].split(":").reverse();
                    let seconds = 0;
                    if (t.length === 3)
                    {
                        seconds = (+t[2]) * 3600 + (+t[1]) * 60 + (+t[0]);
                    } else if (t.length === 2)
                    {
                        seconds = (+t[1]) * 60 + (+t[0]);
                    } else
                    {
                        seconds = +t[0];
                    }
                    const percent = Math.min(100, Math.round((seconds / totalDuration) * 100));
                    const eta = totalDuration && seconds > 0 ?
                        Math.round((totalDuration - seconds) * (Date.now() / 1000) / seconds) + "s" : "Unknown";
                    if (percent !== lastPercent)
                    {
                        lastPercent = percent;
                        throttledBar.update(percent, {
                            currentTime: seconds.toFixed(1),
                            totalTime: totalDuration.toFixed(1),
                            eta: eta
                        });
                    }
                } else
                {
                    // Always show at least 0% if no time info
                    throttledBar.update(0, {
                        currentTime: "0",
                        totalTime: totalDuration ? totalDuration.toFixed(1) : "Unknown",
                        eta: "Calculating..."
                    });
                }
            });

            ffmpeg.on("close", code =>
            {
                setCurrentProcess(null);

                if (isCancelled())
                {
                    throttledBar.stop();
                    reject(new Error("Download operation was cancelled by user"));
                    return;
                }

                throttledBar.update(100, {
                    currentTime: totalDuration ? totalDuration.toFixed(1) : "Complete",
                    totalTime: totalDuration ? totalDuration.toFixed(1) : "Complete",
                    eta: "Complete"
                });
                throttledBar.stop();

                if (code === 0)
                {
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

        // Overwrite detection for YouTube
        const { existsSync, statSync, basename } = require("fs");
        const colors = require("./utils").colors;
        // Try to get the output filename using yt-dlp
        const execAsync = require("util").promisify(require("child_process").exec);
        let outputFilename = null;
        try
        {
            const { stdout } = await execAsync(`yt-dlp --get-filename --output \"%(title)s.%(ext)s\" \"${answers.url}\"`);
            outputFilename = stdout.trim();
        } catch (e) { }
        if (outputFilename)
        {
            const outputPath = join(answers.output, outputFilename);
            if (existsSync(outputPath))
            {
                const stats = statSync(outputPath);
                const fileSize = (stats.size / (1024 * 1024)).toFixed(2);
                console.log(colors.yellow(`\n⚠️  File already exists: ${basename(outputPath)}`));
                console.log(colors.gray(`   Size: ${fileSize} MB`));
                console.log(colors.gray(`   Modified: ${stats.mtime.toLocaleString()}`));
                const inquirer = require("inquirer");
                const { action } = await inquirer.prompt([
                    {
                        type: "list",
                        name: "action",
                        message: "What would you like to do?",
                        choices: [
                            { name: "Overwrite existing file", value: "overwrite" },
                            { name: "Skip this download", value: "skip" }
                        ]
                    }
                ]);
                if (action === "skip")
                {
                    console.log(colors.yellow("Skipping download as requested."));
                    return;
                }
            }
        }

        // Single progress bar that changes color for audio phase
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
            "--output", outputTemplate,
            "--progress",
            "--newline",
            answers.url
        ];

        if (answers.downloadType === "audio-only")
        {
            args.push("--extract-audio", "--audio-format", "mp3");
        }

        return new Promise((resolve, reject) =>
        {
            const ytdlp = spawn("yt-dlp", args);
            setCurrentProcess(ytdlp);

            let currentPhase = answers.downloadType === "audio-only" ? "audio" : "video";
            let buffer = "";
            let lastProgress = -1;
            let isStarted = false;

            throttledBar.start(100, 0, {
                phase: currentPhase,
                speed: "0KB/s",
                eta: "Unknown"
            });

            ytdlp.stdout.on("data", data =>
            {
                if (isCancelled()) return;

                buffer += data.toString();
                const lines = buffer.split("\n");
                buffer = lines.pop();

                for (const line of lines)
                {
                    if (!line.trim()) continue;

                    // Detect phase changes
                    if (line.includes("audio only") || line.includes(".m4a") || line.includes("Extracting audio"))
                    {
                        if (currentPhase !== "audio")
                        {
                            currentPhase = "audio";
                            console.log(colors.yellow("\n[INFO] Switching to audio processing phase"));
                        }
                    }

                    // Handle download progress
                    if (line.includes("[download]") && line.includes("%"))
                    {
                        isStarted = true;
                        const progressMatch = line.match(/\[download\]\s+([0-9.]+)%\s+of\s+([0-9.]+(?:KiB|MiB|GiB))\s+at\s+([0-9.]+(?:\.[0-9]+)?(?:KiB|MiB|GiB))\/s(?:\s+ETA\s+([0-9:]+))?/);

                        if (progressMatch)
                        {
                            const percent = parseFloat(progressMatch[1]);
                            const speed = progressMatch[3];
                            const eta = progressMatch[4] || "Unknown";

                            if (Math.round(percent) !== lastProgress)
                            {
                                lastProgress = Math.round(percent);
                                // cli-progress expects percent (0-100) as value, and will normalize for bar fill
                                throttledBar.update(percent, {
                                    phase: currentPhase,
                                    speed: speed + "/s",
                                    eta: eta
                                });
                            }
                        }
                    }

                    // Handle completion
                    if (line.includes("[download] 100%"))
                    {
                        throttledBar.update(100, {
                            phase: currentPhase,
                            speed: "",
                            eta: ""
                        });
                    }

                    // Handle post-processing
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

                if (isCancelled())
                {
                    throttledBar.stop();
                    reject(new Error("Download operation was cancelled by user"));
                    return;
                }

                throttledBar.update(100, {
                    phase: currentPhase,
                    speed: "",
                    eta: ""
                });
                // Force bar to full
                progressBar.update(100);
                throttledBar.stop();

                if (code === 0)
                {
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