#!/usr/bin/env node

/**
 * GitHub release from an package.json + CHANGELOG
 *
 * Usage:
 *   $ GITHUB_TOKEN=aGitHubToken
 *   $ github-release-rushjs-changelog [--filename CustomChangelog.md]
 *
 * we will use `grizzly` (https://github.com/coderaiser/node-grizzly)
 * so we need
 * - user (user from package.json repo field)
 * - repo (same as)user
 * - tag (version)
 * - release name (tag)
 * - description (changelog section corresponding to tag)
 */
// read command line arguments
import { Octokit } from "@octokit/rest";
import cp from "child_process";
import fs from "fs";
import { readFile } from "fs/promises";
import release from "grizzly";
import minimist from "minimist";

var token = process.env.GITHUB_TOKEN;
if (!token) {
  throw "GITHUB_TOKEN required";
}

async function getReleaseOptions() {
  var argv = minimist(process.argv.slice(2));

  // changelog file name
  var changelogFileName = argv.filename;
  if (!changelogFileName) {
    const changelogFileNames = [
      "CHANGELOG.md",
      "Changelog.md",
      "changelog.md",
      "CHANGES.md",
      "Changes.md",
      "changes.md",
      "HISTORY.md",
      "History.md",
      "history.md",
      "NEWS.md",
      "News.md",
      "news.md",
      "RELEASES.md",
      "Releases.md",
      "releases.md"
    ];
    for (var fileName of changelogFileNames) {
      if (fs.existsSync(fileName)) {
        changelogFileName = fileName;
        break;
      }
    }
  }
  // console.log("changelog filename", changelogFileName);

  // read package.json
  var pkg;
  try {
    pkg = JSON.parse(await readFile(process.cwd() + "/package.json"));
  } catch (e) {
    console.log(e);
    throw "No package.json found in " + process.cwd();
  }

  // read changelog
  var changelog;
  try {
    changelog = fs.readFileSync(process.cwd() + "/" + changelogFileName, {
      encoding: "utf8"
    });
  } catch (e) {
    throw "No " + changelogFileName + " found in " + process.cwd();
  }

  // parse repository url to get user & repo slug
  var repoUrl;
  repoUrl = pkg.repository;
  if (repoUrl === undefined) {
    throw "No repository.url found in " + process.cwd() + "/repository(.url)";
  }
  if (typeof repoUrl === "object" && repoUrl.url) {
    repoUrl = repoUrl.url;
  }
  var matches = repoUrl.match(
    /(?:https?|git(?:\+ssh)?)(?::\/\/)(?:www\.)?github\.com\/(.*)/i
  );
  if (matches === null) {
    throw "Unable to parse repository url";
  }
  var repoData = matches[1].split("/");
  var user = repoData[0];
  var repo = repoData[1].replace(/\.git$/, "");

  // version
  var version = pkg.version;

  // Look for the tag in "<pkg.name>_v<pgk.version>" format
  var tags = cp.execSync("git tag", { encoding: "utf8" });
  var tagMatches = tags.match(
    new RegExp("^(" + pkg.name + "_v)?" + version + "$", "gm")
  );
  var tagName;
  if (tagMatches === null) {
    throw "Tag " + version + " or v" + version + " not found";
  } else {
    tagName = tagMatches[0];
  }

  // changelog
  var body = [];
  var start;
  const changelogLines = changelog.replace(/\r\n/g, "\n").split("\n");
  // determine whether the log format of http://keepachangelog.com/en/1.0.0/: check the first line and check if there is a second level heading linking to the version diff
  const isKeepAChangelogFormat = true;
  // =
  //  changelogLines[0] === "# Change Log" &&
  //  changelog.indexOf("\n## [" + version + "]") !== -1;
  // console.log(isKeepAChangelogFormat);

  // read from # version to the next # .*
  changelogLines.some(function(line, i) {
    // start with the # version
    if (!start && line.indexOf("## " + version) === 0) {
      start = true;
    } else if (
      start &&
      (line.indexOf("# ") === 0 ||
        (isKeepAChangelogFormat && line.indexOf("## ") === 0) ||
        line.indexOf("[") === 0)
    ) {
      // end with another # version or a footer link
      return true;
    } else if (start) {
      // between start & end, collect lines
      body.push(line);
    }
  });
  body = body.join("\n").trim();

  // prepare release data
  var releaseOptions = {
    user: user,
    repo: repo,
    tag: tagName,
    name: tagName,
    body: body
  };

  return releaseOptions;
}

(async () => {
  const releaseOptions = await getReleaseOptions();
  const releasePath =
    releaseOptions.user + "/" + releaseOptions.repo + " " + releaseOptions.tag;

  const octokit = new Octokit({
    auth: `token ${token}`
  });

  // If a release with this tag already exists
  // we will not issue a new release
  let shouldRelease = false;
  try {
    await octokit.repos.getReleaseByTag({
      repo: releaseOptions.repo,
      owner: releaseOptions.user,
      tag: releaseOptions.tag
    });
  } catch (e) {
    if (e.status === 404) {
      shouldRelease = true;
    } else {
      throw e;
    }
  }

  if (shouldRelease) {
    release(token, releaseOptions, function(err) {
      if (err) {
        console.log(err);
        throw err;
      }
      console.log(releasePath, "released");
    });
  } else {
    console.log(releasePath, "already exists");
  }
})();
