const inquirer = require("inquirer");
const { colors, isYouTube, ensureOutputDirectory, isValidYouTubeMediaUrl } = require("./utils");
const { downloadY, downloadO } = require("./downloader");

let currentDownloadProcess = null;
let isCancelled = false;
let progressBars = null;

let currentDownloaderType = null;
let hotkeyListenerActive = false;
function setupDownloadControls(type)
{
    currentDownloaderType = type;
    console.log();
    console.log("  [C] - Cancel download");
    console.log("  [O] - Open output folder");
    console.log();
    if (process.stdin.isTTY)
    {
        if (hotkeyListenerActive)
        {
            process.stdin.removeListener("data", handleKeyPress);
            hotkeyListenerActive = false;
        }
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", handleKeyPress);
        hotkeyListenerActive = true;
    }
}

function handleKeyPress(key)
{
    if (key === "c" || key === "C")
    {
        cancelDownload();
        return;
    }
    if (key === "o" || key === "O")
    {
        openOutputFolder();
        return;
    }


    function openOutputFolder()
    {
        const path = require("path");
        const fs = require("fs");
        let outputDir = null;
        if (currentDownloaderType === 'yt-dlp' && global.lastYTAnswers && global.lastYTAnswers.output)
        {
            outputDir = global.lastYTAnswers.output;
        } else if (currentDownloaderType === 'ffmpeg' && global.lastOtherOutput)
        {
            outputDir = global.lastOtherOutput;
        } else
        {
            outputDir = "./downloads";
        }
        outputDir = path.resolve(outputDir);
        if (!fs.existsSync(outputDir))
        {
            console.log(colors.red(`\n Output directory does not exist: ${outputDir}`));
            return;
        }
        const { exec } = require("child_process");
        let command;
        if (process.platform === "win32")
        {
            command = `explorer "${outputDir}"`;
        } else if (process.platform === "darwin")
        {
            command = `open "${outputDir}"`;
        } else
        {
            command = `xdg-open "${outputDir}"`;
        }
        exec(command, err =>
        {
            if (err)
            {
                if (process.platform !== "win32")
                {
                    console.log(colors.red("\n Failed to open output folder:"), err.message);
                }
            }
        });
    }
}



function cancelDownload()
{
    if (!currentDownloadProcess) { return; }
    if (cancelDownload.cancelled) {return;}
    cancelDownload.cancelled = true;
    console.log();
    console.log(colors.red("\n Cancelling download..."));
    isCancelled = true;
    if (typeof currentDownloadProcess.kill === 'function')
    {
        currentDownloadProcess.kill();
    } else if (currentDownloadProcess.proc && typeof currentDownloadProcess.proc.kill === 'function')
    {
        currentDownloadProcess.proc.kill('SIGTERM');
    }
    if (progressBars)
    {
        progressBars.stop();
    }
}

async function downloadLoop()
{
    while (true)
    {
        try
        {
            const { url } = await inquirer.prompt([
                {
                    type: "input",
                    name: "url",
                    message: "Enter the Video URL:",
                    validate: input =>
                    {
                        if (!input) { return "URL cannot be empty"; }
                        if (input.toLowerCase() === "exit") { return true; }
                        return true;
                    }
                }
            ]);
            if (url.toLowerCase() === "q")
            {
                break;
            }
            if (isYouTube(url))
            {
                if (!isValidYouTubeMediaUrl(url))
                {
                    require("./utils").clearScreen();
                    console.log(colors.red("\n Please enter a valid YouTube video, short, or playlist URL."));
                    continue;
                }
                const ytAnswers = await inquirer.prompt([
                    {
                        type: "list",
                        name: "downloadType",
                        message: "Download type:",
                        choices: ["video", "audio-only"]
                    },
                    {
                        type: "list",
                        name: "quality",
                        message: "Select video quality:",
                        choices: ["1440p", "1080p", "720p", "best"],
                        when: answers => answers.downloadType === "video"
                    },
                    {
                        type: "input",
                        name: "output",
                        message: "Enter output directory:",
                        default: "./downloads"
                    }
                ]);
                ensureOutputDirectory(ytAnswers.output);
                global.lastYTAnswers = ytAnswers;
                setupDownloadControls('yt-dlp');
                cancelDownload.cancelled = false;
                await downloadY(
                    { url, ...ytAnswers },
                    proc => currentDownloadProcess = proc,
                    bars => progressBars = bars,
                    () => isCancelled
                );
            } else
            {
                const { output } = await inquirer.prompt([
                    {
                        type: "input",
                        name: "output",
                        message: "Enter output directory:",
                        default: "./downloads"
                    }
                ]);
                ensureOutputDirectory(output);
                global.lastOtherOutput = output;
                setupDownloadControls('ffmpeg');
                cancelDownload.cancelled = false;
                await downloadO(
                    { url, output },
                    proc => currentDownloadProcess = proc,
                    () => isCancelled
                );
            }
            console.log();
            const { continueDownloading } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "continueDownloading",
                    message: "Would you like to download another video?",
                    default: true
                }
            ]);
            if (!continueDownloading)
            {
                console.log();
                console.log(colors.yellow("Thanks for using the vdwn!"));
                break;
            }
            require("./utils").clearScreen();
        } catch (error)
        {
            if (error.message && error.message.includes("cancelled"))
            {
                console.log(colors.yellow("\n  Download was cancelled by user."));
                console.log();
            } else
            {
                console.error(colors.red("\n Error:"), error && error.stack ? error.stack : error.message);
            }
            const { continueDownloading } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "continueDownloading",
                    message: "Would you like to download another video?",
                    default: true
                }
            ]);
            if (!continueDownloading)
            {
                console.log();
                console.log(colors.yellow("Thanks for using the vdwn!"));
                break;
            }
            require("./utils").clearScreen();
        }
        isCancelled = false;
        currentDownloadProcess = null;
        cancelDownload.cancelled = false;
    }
}

module.exports = {
    downloadLoop
};
