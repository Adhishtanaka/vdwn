const { existsSync, mkdirSync, statSync } = require("fs");
const { join, basename } = require("path");
const colors = require("ansi-colors");

function clearScreen()
{
    const { exec } = require("child_process");
    const platform = process.platform;
    if (platform === "win32")
    {
        exec("cls");
    } else
    {
        exec("clear");
    }
    console.clear();
}

const isYouTube = url => /youtube\.com|youtu\.be|m\.youtube\.com/.test(url);

function ensureOutputDirectory(dir)
{
    if (!existsSync(dir))
    {
        mkdirSync(dir, { recursive: true });
        console.log(colors.gray(`[INFO] Created output directory: ${dir}`));
    }
}

function getFormatSelector(answers)
{
    if (answers.downloadType === "audio-only")
    {
        return "bestaudio/best";
    }
    const qualityMap = {
        "1440p": "bestvideo[height<=1440]+bestaudio/best[ext=mp4]",
        "1080p": "bestvideo[height<=1080]+bestaudio/best[ext=mp4]",
        "720p": "bestvideo[height<=720]+bestaudio/best[ext=mp4]",
        "best": "best[ext=mp4]"
    };
    return qualityMap[answers.quality];
}

function isValidYouTubeMediaUrl(url)
{
    try
    {
        const u = new URL(url);
        if (!/^(www\.)?youtube\.com$|^(m\.)?youtube\.com$|^(www\.)?youtu\.be$/.test(u.hostname)) {return false;}
        if (u.hostname.includes("youtu.be"))
        {
            return u.pathname.length > 1;
        }
        if (u.pathname === "/watch" && u.searchParams.has("v")) {return true;}
        if (u.pathname.startsWith("/shorts/") && u.pathname.split("/")[2]) {return true;}
        if (u.pathname === "/playlist" && u.searchParams.has("list")) {return true;}
        if (u.pathname === "/watch" && u.searchParams.has("list")) {return true;}
        return false;
    } catch
    {
        return false;
    }
}

module.exports = {
    clearScreen,
    isYouTube,
    isValidYouTubeMediaUrl,
    ensureOutputDirectory,
    getFormatSelector,
    join,
    basename,
    existsSync,
    mkdirSync,
    statSync,
    colors
};