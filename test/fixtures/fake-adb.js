#!/usr/bin/env node
// A stand-in for adb: `-s <serial> shell pm list packages -3` and `... shell cmd package resolve-activity ... <pkg>`.
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const shell = args.indexOf('shell');
const cmd = shell >= 0 ? args.slice(shell + 1) : args.slice(2);
if (process.env.FAKE_ADB_LOG) fs.appendFileSync(process.env.FAKE_ADB_LOG, cmd.join(' ') + '\n');
if (cmd[0] === 'am' && cmd[1] === 'force-stop' || cmd[0] === 'pkill' || cmd[0] === 'uninstall') process.exit(0);
if (cmd[0] === 'pm' && cmd[1] === 'list') {
    process.stdout.write(fs.readFileSync(path.join(__dirname, 'pm-list-packages.txt'), 'utf8'));
} else if (cmd[0] === 'cmd' && cmd.includes('resolve-activity')) {
    const pkg = cmd[cmd.length - 1];
    console.log('priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false');
    console.log(pkg === 'com.starlettech.letsbet.stage' ? pkg + '/com.starlettech.letsbet.ui.splash.SplashActivity' : 'No activity found');
} else {
    console.error('fake adb: ' + args.join(' '));
    process.exit(1);
}
