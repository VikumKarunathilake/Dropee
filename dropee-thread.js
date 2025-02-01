const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const headers = require("./src/header");
const printLogo = require('./src/logo');


class DropeeAPIClient {
    constructor(proxy = null, accountIndex = 0) {
        this.baseUrl = 'https://dropee.clicker-game-api.tropee.com/api/game';
        this.headers = headers;

        this.accountIndex = accountIndex;
        this.proxyIP = 'Unknown IP';
        this.tokenFile = path.join(__dirname, 'token.json');
        this.loadTokens();

        try {
            const configPath = path.join(__dirname, 'config.json');
            if (fs.existsSync(configPath)) {
                this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } else {
                this.config = {
                    maxUpgradePrice: 500000
                };
                fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
            }
        } catch (error) {
            this.log('Cannot read config file, using default', 'error');
            this.config = {
                maxUpgradePrice: 5000
            };
        }

        this.proxy = proxy;
        if (this.proxy) {
            this.proxyAgent = new HttpsProxyAgent(this.proxy);
            this.axiosInstance = axios.create({
                httpsAgent: this.proxyAgent,
                proxy: false
            });
        } else {
            this.axiosInstance = axios;
        }
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const accountPrefix = `[Account ${this.accountIndex + 1}]`;
        const ipPrefix = `[${this.proxyIP}]`;
        const formattedType = type.toUpperCase();

        let logMessage = `${timestamp} | ${formattedType} | ${accountPrefix} | ${ipPrefix} | ${msg}`;

        switch (type) {
            case 'success':
                logMessage = logMessage.green;
                break;
            case 'error':
                logMessage = logMessage.red;
                break;
            case 'warning':
                logMessage = logMessage.yellow;
                break;
            default:
                logMessage = logMessage.blue;
        }

        console.log(logMessage);
    }

    loadTokens() {
        try {
            if (fs.existsSync(this.tokenFile)) {
                this.tokens = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
            } else {
                this.tokens = {};
                fs.writeFileSync(this.tokenFile, JSON.stringify(this.tokens, null, 2));
            }
        } catch (error) {
            this.log(`Error loading tokens: ${error.message}`, 'error');
            this.tokens = {};
        }
    }

    saveToken(userId, token) {
        try {
            this.tokens[userId] = token;
            fs.writeFileSync(this.tokenFile, JSON.stringify(this.tokens, null, 2));
            this.log(`Token saved for account ${userId}`, 'success');
        } catch (error) {
            this.log(`Cannot save token: ${error.message}`, 'error');
        }
    }

    async getValidToken(userId, initData) {
        const existingToken = this.tokens[userId];

        if (existingToken && !this.isTokenExpired(existingToken)) {
            return existingToken;
        }

        this.log('Token does not exist or has expired, logging in...', 'warning');
        const loginResult = await this.login(initData);

        if (loginResult.success) {
            this.saveToken(userId, loginResult.token);
            return loginResult.token;
        }

        throw new Error(`No valid token found: ${loginResult.error}`);
    }

    isTokenExpired(token) {
        if (!token) return true;

        try {
            const [, payload] = token.split('.');
            if (!payload) return true;

            const decodedPayload = JSON.parse(Buffer.from(payload, 'base64').toString());
            const now = Math.floor(Date.now() / 1000);

            if (!decodedPayload.exp) {
                this.log('Eternal token', 'warning');
                return false;
            }

            return now > decodedPayload.exp;
        } catch (error) {
            this.log(`Error checking token: ${error.message}`, 'error');
            return true;
        }
    }

    async axiosRequest(method, url, data = null, customHeaders = {}) {
        const headers = { ...this.headers, ...customHeaders };

        try {
            const response = await this.axiosInstance({
                method,
                url,
                data,
                headers
            });
            return response;
        } catch (error) {
            throw error;
        }
    }

    async login(initData) {
        const url = `${this.baseUrl}/telegram/me`;
        const payload = {
            initData: initData,
            referrerCode: "93KvKm9wl8v",
            utmSource: null,
            impersonationToken: null
        };

        try {
            const response = await this.axiosRequest('post', url, payload);
            return response.status === 200 ?
                { success: true, token: response.data.token } :
                { success: false, error: response.data.message };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    generateEnergyDistribution(totalEnergy, parts) {
        if (totalEnergy < parts) return null;

        let remaining = totalEnergy;
        let distribution = [];

        for (let i = 0; i < parts - 1; i++) {
            const maxForThisPart = Math.min(200, remaining - (parts - i - 1));
            const minRequired = remaining - (200 * (parts - i - 1));
            const minValue = Math.max(1, minRequired);
            const maxValue = Math.min(maxForThisPart, remaining - (parts - i - 1));

            const value = Math.floor(Math.random() * (maxValue - minValue + 1)) + minValue;
            distribution.push(value);
            remaining -= value;
        }

        distribution.push(remaining);
        return distribution;
    }

    async tap(token, count) {
        const url = `${this.baseUrl}/actions/tap`;
        const headers = { "Authorization": `Bearer ${token}` };

        try {
            let totalCoins = 0;
            const energyParts = this.generateEnergyDistribution(count, 10);

            if (!energyParts) {
                this.log('Not enough energy to tap 10 times (minimum 10)', 'error');
                return { success: false, error: 'Insufficient energy' };
            }

            for (let i = 0; i < energyParts.length; i++) {
                const duration = Math.floor(Math.random() * (40 - 35 + 1)) + 35;
                const payload = {
                    count: energyParts[i],
                    startTimestamp: Math.floor(Date.now() / 1000),
                    duration: duration,
                    availableEnergy: count - energyParts.slice(0, i + 1).reduce((a, b) => a + b, 0)
                };

                const response = await this.axiosRequest('post', url, payload, headers);
                if (response.status === 200) {
                    totalCoins = response.data.coins;
                    this.log(`Tap ${i + 1}/10: ${energyParts[i]} Energy | Duration: ${duration}ms`, 'custom');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            return { success: true, data: { coins: totalCoins } };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async syncGame(token) {
        const url = `${this.baseUrl}/sync`;
        const headers = { "Authorization": `Bearer ${token}` };

        try {
            const response = await this.axiosRequest('post', url, {}, headers);
            if (response.status === 200) {
                const stats = response.data.playerStats;
                return {
                    success: true,
                    data: {
                        coins: stats.coins,
                        profit: stats.profit,
                        energy: {
                            available: stats.energy.available,
                            max: stats.energy.max
                        },
                        onboarding: stats.onboarding.done,
                        tasks: stats.tasks
                    }
                };
            }
            return { success: false, error: response.data.message };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async performDailyCheckin(token) {
        const url = `${this.baseUrl}/actions/tasks/daily-checkin`;
        const headers = { "Authorization": `Bearer ${token}` };
        const payload = { timezoneOffset: -420 };

        try {
            const response = await this.axiosRequest('post', url, payload, headers);
            return response.status === 200 ?
                { success: true, data: response.data } :
                { success: false, error: response.data.message };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    shouldPerformCheckin(lastCheckin) {
        if (!lastCheckin) return true;

        const today = new Date().toISOString().split('T')[0];
        const lastCheckinDate = new Date(lastCheckin);
        return today !== lastCheckinDate.toISOString().split('T')[0];
    }

    async getFortuneWheelState(token) {
        const url = `${this.baseUrl}/fortune-wheel`;
        const headers = { "Authorization": `Bearer ${token}` };

        try {
            const response = await this.axiosRequest('get', url, null, headers);
            return response.status === 200 ?
                { success: true, data: response.data.state } :
                { success: false, error: response.data.message };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async spinFortuneWheel(token) {
        const url = `${this.baseUrl}/actions/fortune-wheel/spin`;
        const headers = { "Authorization": `Bearer ${token}` };
        const payload = { version: 3 };

        try {
            const response = await this.axiosRequest('post', url, payload, headers);
            return response.status === 200 ?
                { success: true, data: response.data } :
                { success: false, error: response.data.message };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async performFortuneWheelSpins(token) {
        const stateResult = await this.getFortuneWheelState(token);
        if (!stateResult.success) {
            this.log(`Cannot check fortune wheel state: ${stateResult.error}`, 'error');
            return;
        }

        const availableSpins = stateResult.data.spins.available;
        if (availableSpins <= 0) {
            this.log('No spins available!', 'warning');
            return;
        }

        this.log(`${availableSpins} spins available!`, 'info');

        for (let i = 0; i < availableSpins; i++) {
            this.log(`Performing spin ${i + 1}/${availableSpins}...`, 'info');
            const spinResult = await this.spinFortuneWheel(token);

            if (spinResult.success) {
                const prize = spinResult.data.prize;
                const prizeMsg = prize.type === 'usdt' ? `${prize.amount} USDT` : prize.id;
                this.log(`Spin successful! Received: ${prizeMsg}`, 'success');
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
                this.log(`Spin failed: ${spinResult.error}`, 'error');
            }
        }
    }

    async getConfig(token) {
        const url = `${this.baseUrl}/config`;
        const headers = { "Authorization": `Bearer ${token}` };

        try {
            const response = await this.axiosRequest('get', url, null, headers);
            return response.status === 200 ?
                { success: true, data: response.data } :
                { success: false, error: response.data.message };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async completeTask(token, taskId) {
        const url = `${this.baseUrl}/actions/tasks/action-completed`;
        const headers = { "Authorization": `Bearer ${token}` };
        const payload = { taskId };

        try {
            const response = await this.axiosRequest('post', url, payload, headers);
            return { success: response.status === 200 };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async claimTaskReward(token, taskId) {
        const url = `${this.baseUrl}/actions/tasks/done`;
        const headers = { "Authorization": `Bearer ${token}` };
        const payload = { taskId };

        try {
            const response = await this.axiosRequest('post', url, payload, headers);
            return {
                success: response.status === 200,
                data: response.data
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async handleTasks(token) {
        try {
            const configResult = await this.getConfig(token);
            if (!configResult.success) {
                this.log(`Cannot get config: ${configResult.error}`, 'error');
                return;
            }

            const incompleteTasks = configResult.data.config.tasks.filter(task => !task.isDone);
            if (incompleteTasks.length === 0) {
                this.log('All tasks completed!', 'success');
                return;
            }

            for (const task of incompleteTasks) {
                this.log(`Performing task: ${task.title}...`, 'info');

                const completeResult = await this.completeTask(token, task.id);
                if (!completeResult.success) {
                    this.log(`Cannot complete task ${task.id}: ${completeResult.error}`, 'error');
                    continue;
                }

                if (task.claimDelay > 0) {
                    this.log(`Waiting ${task.claimDelay} seconds to claim reward...`, 'warning');
                    await new Promise(resolve => setTimeout(resolve, task.claimDelay * 1000));
                }

                const claimResult = await this.claimTaskReward(token, task.id);
                if (claimResult.success) {
                    this.log(`Task ${task.title} completed | reward ${task.reward}`, 'success');
                } else {
                    this.log(`Cannot claim task reward ${task.id}: ${claimResult.error}`, 'error');
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            this.log(`Error: ${error.message}`, 'error');
        }
    }

    async handleUpgrades(token, availableCoins) {
        try {
            const configResult = await this.getConfig(token);
            if (!configResult.success) {
                this.log(`Cannot get config: ${configResult.error}`, 'error');
                return;
            }

            let upgrades = configResult.data.config.upgrades
                .filter(upgrade =>
                    upgrade.price <= this.config.maxUpgradePrice &&
                    upgrade.price <= availableCoins &&
                    (!upgrade.expiresOn || upgrade.expiresOn > Math.floor(Date.now() / 1000))
                )
                .map(upgrade => ({
                    ...upgrade,
                    roi: upgrade.profitDelta / upgrade.price
                }))
                .sort((a, b) => b.roi - a.roi);

            if (upgrades.length === 0) {
                this.log('No cards to upgrade!', 'warning');
                return;
            }

            for (const upgrade of upgrades) {
                if (upgrade.price > availableCoins) {
                    this.log(`Not enough balance to upgrade card ${upgrade.name} (requires ${upgrade.price} coins)`, 'warning');
                    continue;
                }

                this.log(`Upgrading ${upgrade.name} (${upgrade.price} coins, +${upgrade.profitDelta} profit)...`, 'info');
                const purchaseResult = await this.purchaseUpgrade(token, upgrade.id);

                if (purchaseResult.success) {
                    this.log(`Upgrade ${upgrade.name} successful!`, 'success');
                    availableCoins -= upgrade.price;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    this.log(`Upgrade ${upgrade.name} failed: ${purchaseResult.error}`, 'error');
                }
            }
        } catch (error) {
            this.log(`Error: ${error.message}`, 'error');
        }
    }

    async purchaseUpgrade(token, upgradeId) {
        const url = `${this.baseUrl}/actions/upgrade`;
        const headers = { "Authorization": `Bearer ${token}` };
        const payload = { upgradeId };

        try {
            const response = await this.axiosRequest('post', url, payload, headers);
            return response.status === 200 ?
                { success: true, data: response.data } :
                { success: false, error: response.data.message };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async checkProxyIP() {
        try {
            const response = await this.axiosInstance.get('https://api.ipify.org?format=json');
            return response.status === 200 ? response.data.ip : 'Unknown IP';
        } catch (error) {
            throw new Error(`Proxy IP check error: ${error.message}`);
        }
    }

    async completeOnboarding(token) {
        const url = `${this.baseUrl}/actions/onboarding/done`;
        const headers = { "Authorization": `Bearer ${token}` };

        try {
            const response = await this.axiosRequest('post', url, {}, headers);
            return response.status === 200 ?
                { success: true } :
                { success: false, error: response.data.message };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

async function processAccount(initData, proxy, accountIndex) {
    const client = new DropeeAPIClient(proxy, accountIndex);
    const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
    const userId = userData.id;
    const firstName = userData.first_name;

    try {
        if (proxy) {
            try {
                client.proxyIP = await client.checkProxyIP();
            } catch (proxyError) {
                client.log(`Proxy error: ${proxyError.message}`, 'error');
                return;
            }
        }

        const token = await client.getValidToken(userId, initData);
        client.log(`Using token for account ${userId}`, 'success');

        const syncResult = await client.syncGame(token);
        if (syncResult.success) {
            client.log(`Coins: ${syncResult.data.coins} | Profit: ${syncResult.data.profit} | Energy: ${syncResult.data.energy.available}/${syncResult.data.energy.max}`, 'custom');

            if (!syncResult.data.onboarding) {
                client.log('Incomplete onboarding detected, processing...', 'warning');
                const onboardingResult = await client.completeOnboarding(token);
                if (onboardingResult.success) {
                    client.log('Onboarding completed successfully!', 'success');
                } else {
                    client.log(`Onboarding completion failed: ${onboardingResult.error}`, 'error');
                }
            }

            if (syncResult.data.energy.available >= 10) {
                client.log(`Remaining ${syncResult.data.energy.available} energy, starting tap...`, 'warning');
                const tapResult = await client.tap(token, syncResult.data.energy.available);
                if (tapResult.success) {
                    client.log(`Tap successful | Balance: ${tapResult.data.coins}`, 'success');
                } else {
                    client.log(`Tap failed: ${tapResult.error}`, 'error');
                }
            } else {
                client.log('Not enough energy to tap (minimum 10)', 'warning');
            }

            const lastCheckin = syncResult.data.tasks?.dailyCheckin?.lastCheckin || '';
            if (client.shouldPerformCheckin(lastCheckin)) {
                client.log('Performing daily check-in...', 'warning');
                const checkinResult = await client.performDailyCheckin(token);
                if (checkinResult.success) {
                    client.log('Check-in successful!', 'success');
                } else {
                    client.log(`Check-in failed: ${checkinResult.error}`, 'error');
                }
            } else {
                client.log('You have already checked in today!', 'warning');
            }

            await client.performFortuneWheelSpins(token);
            await client.handleTasks(token);
            await client.handleUpgrades(token, syncResult.data.coins);

            const finalSync = await client.syncGame(token);
            if (finalSync.success) {
                client.log('=== Final Statistics ===', 'custom');
                client.log(`Coins: ${finalSync.data.coins}`, 'custom');
                client.log(`Profit: ${finalSync.data.profit}`, 'custom');
                client.log(`Energy: ${finalSync.data.energy.available}/${finalSync.data.energy.max}`, 'custom');
            }
        } else {
            client.log(`Error: ${syncResult.error}`, 'error');
        }
    } catch (error) {
        client.log(`Error processing account ${userId}: ${error.message}`, 'error');
    }
}

if (isMainThread) {
    const MAX_THREADS = 10;
    const ACCOUNT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
    const LOOP_DELAY = 600 * 1000; // 300 seconds

    async function runWorker(initData, proxy, accountIndex) {
        return new Promise((resolve) => {
            const worker = new Worker(__filename, {
                workerData: { initData, proxy, accountIndex }
            });

            const timeout = setTimeout(() => {
                worker.terminate();
                console.log(`[Account ${accountIndex + 1}] Timed out after 10 minutes`.red);
                resolve();
            }, ACCOUNT_TIMEOUT);

            worker.on('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }

    async function main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const proxyFile = path.join(__dirname, 'proxy.txt');

        printLogo();

        while (true) {
            try {
                const data = fs.readFileSync(dataFile, 'utf8')
                    .replace(/\r/g, '')
                    .split('\n')
                    .filter(Boolean);

                const proxies = fs.readFileSync(proxyFile, 'utf8')
                    .replace(/\r/g, '')
                    .split('\n')
                    .filter(Boolean);

                console.log('=== Starting new processing cycle ==='.green);

                for (let i = 0; i < data.length; i += MAX_THREADS) {
                    const batch = data.slice(i, Math.min(i + MAX_THREADS, data.length));
                    const workers = batch.map((initData, index) =>
                        runWorker(initData, proxies[i + index] || null, i + index)
                    );

                    await Promise.all(workers);
                }

                console.log('=== Completed processing all accounts ==='.green);
                console.log(`Waiting ${LOOP_DELAY / 1000} seconds to continue...`.yellow);
                await new Promise(resolve => setTimeout(resolve, LOOP_DELAY));
            } catch (error) {
                console.error('Main process error:', error);
                await new Promise(resolve => setTimeout(resolve, 60000));
            }
        }
    }

    main().catch(console.error);
} else {
    const { initData, proxy, accountIndex } = workerData;
    processAccount(initData, proxy, accountIndex).catch(console.error);
}