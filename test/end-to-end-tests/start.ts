/*
Copyright 2018 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as fs from "fs";
import { Command } from "commander";

import { ElementSession } from './src/session';
import { scenario } from './src/scenario';

const program = new Command();

program
    .option('--no-logs', "don't output logs, document html on error", false)
    .option('--app-url [url]', "url to test", "http://localhost:5000")
    .option('--windowed', "dont run tests headless", false)
    .option('--slow-mo', "type at a human speed", false)
    .option('--dev-tools', "open chrome devtools in browser window", false)
    .option('--throttle-cpu [factor]', "factor to slow down the cpu with", parseFloat, 1.0)
    .option('--no-sandbox', "same as puppeteer arg", false)
    .option('--log-directory <dir>', 'a directory to dump html and network logs in when the tests fail')
    .requiredOption('--registration-shared-secret <secret>', 'the secret to use for registering users')
    .parse(process.argv);

const hsUrl = 'http://localhost:5005';

async function runTests() {
    const sessions = [];
    const options = {
        slowMo: program.opts().slowMo ? 20 : undefined,
        devtools: program.opts().devTools,
        headless: !program.opts().windowed,
        args: [],
    };
    if (!program.opts().sandbox) {
        options.args.push('--no-sandbox', '--disable-setuid-sandbox');
    }
    if (process.env.CHROME_PATH) {
        const path = process.env.CHROME_PATH;
        console.log(`(using external chrome/chromium at ${path}, make sure it's compatible with puppeteer)`);
        options['executablePath'] = path;
    }

    async function createSession(username: string) {
        const session = await ElementSession.create(
            username, options, program.opts().appUrl, hsUrl, program.opts().throttleCpu,
        );
        sessions.push(session);
        return session;
    }

    let failure = false;
    try {
        await scenario(createSession);
    } catch (err) {
        failure = true;
        console.log('failure: ', err);
        if (program.opts().logDirectory) {
            await writeLogs(sessions, program.opts().logDirectory);
        }
    }

    // wait 5 minutes on failure if not running headless
    // to inspect what went wrong
    if (failure && options.headless === false) {
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
    }

    let performanceEntries;

    await Promise.all(sessions.map(async (session) => {
        // Collecting all performance monitoring data before closing the session
        const measurements = await session.page.evaluate(() => {
            let measurements;

            // Some tests do redirects away from the app, so don't count those sessions.
            if (!window.mxPerformanceMonitor) return JSON.stringify([]);

            window.mxPerformanceMonitor.addPerformanceDataCallback({
                entryNames: [
                    window.mxPerformanceEntryNames.REGISTER,
                    window.mxPerformanceEntryNames.LOGIN,
                    window.mxPerformanceEntryNames.JOIN_ROOM,
                    window.mxPerformanceEntryNames.CREATE_DM,
                    window.mxPerformanceEntryNames.VERIFY_E2EE_USER,
                ],
                callback: (events) => {
                    measurements = JSON.stringify(events);
                },
            }, true);
            return measurements;
        });

        /**
         * TODO: temporary only use one user session data
         */
        performanceEntries = JSON.parse(measurements ?? "[]");
        return session.close();
    }));
    if (performanceEntries?.length > 0) {
        fs.writeFileSync(`performance-entries.json`, JSON.stringify(performanceEntries));
    }
    if (failure) {
        process.exit(-1);
    } else {
        console.log('all tests finished successfully');
    }
}

async function writeLogs(sessions, dir) {
    const logs = "";
    for (let i = 0; i < sessions.length; ++i) {
        const session = sessions[i];
        const userLogDir = `${dir}/${session.username}`;
        try {
            fs.mkdirSync(userLogDir);
        } catch (e) {
            // typically this will be EEXIST. If it's something worse, the next few
            // lines will fail too.
            console.warn(`non-fatal error creating ${userLogDir} :`, e.message);
        }
        const consoleLogName = `${userLogDir}/console.log`;
        const networkLogName = `${userLogDir}/network.log`;
        const appHtmlName = `${userLogDir}/app.html`;
        const documentHtml = await session.page.content();
        fs.writeFileSync(appHtmlName, documentHtml);
        fs.writeFileSync(networkLogName, session.networkLogs());
        fs.writeFileSync(consoleLogName, session.consoleLogs());
        await session.page.screenshot({ path: `${userLogDir}/screenshot.png` });
    }
    return logs;
}

runTests().catch(function(err) {
    console.log(err);
    process.exit(-1);
});
