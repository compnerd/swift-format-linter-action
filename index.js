// Copyright (c) 2020 Hesham Salman
// Copyright (c) 2021 Saleem Abdulrasool <compnerd@compnerd.org>
// SPDX-License-Identifier: MIT

const core = require('@actions/core');
const github = require('@actions/github');

async function format(file) {
  const { spawn } = require('child_process');

  return new Promise(function (resolve, reject) {
    var issues = 0;
    const lint = spawn("swift", ["format", "lint", file]);
    lint.stderr.on('data', (data) => {
      data.toString()
          .split('\n')
          .forEach(issue => {
            const ISSUE_REGEX = /^(.*):([0-9]+):([0-9]+): (warning|error): (.*)$/g;
            for (let report of issue.matchAll(ISSUE_REGEX)) {
              const [_, path, line, column, level, message, index, input, groups] = report;
              console.log(`::${level.trim()} file=${path.trim()},line=${line.trim()},col=${column.trim()}::${message.trim()}`);
              issues += 1;
            }
          });
    });
    // Unfortunately, `swift-format` does not provide an exit code to indicate
    // if there were issues detected or not.  We instead count the number of
    // reported lint warnings and use that to determine whether the promise
    // should be fulfilled or cancelled.
    lint.on('exit', (code) => {
      if (issues === 0) {
        resolve();
      } else {
        reject(`${issues} issues detected in ${file}`);
      }
    });
  });
}

async function changed() {
  const token = core.getInput('github-token');
  const octokit = github.getOctokit(token);

  const { data } = await octokit.rest.pulls.listFiles({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: github.context.payload.pull_request.number,
  });

  // We cannot lint any files which have been deleted in this pull request.
  //
  // Early filter just the swift items, we know that we cannot process the
  // other files, so lets reduce the items being scanned in the filters.
  let files = data.filter(item => item.status !== 'deleted')
                  .map(item => item.filename)
                  .filter(file => file.endsWith('.swift'));

  JSON.parse((core.getInput('excluded-types') || '[]').trim()).forEach(ext => {
    files = files.filter(file => !file.endsWith(ext));
  });

  JSON.parse((core.getInput('excludes') || '[]').trim()).forEach(path => {
    files = files.filter(file => !file.startsWith(path));
  });

  return files;
}

async function lint() {
  const files = await changed();
  if (files.length == 0)
    return [Promise.resolve()];
  return files.map(file => format(file));
}

async function main() {
  Promise.all(await lint()).then(() => {
    console.log('done');
  }).catch((err) => {
    console.log(err);
    core.setFailed('swift-format failed check');
  });
}

main()
