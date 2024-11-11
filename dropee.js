const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const printLogo = require('./src/logo');
const headers = require("./src/header");
const log = require('./src/logger');


class DropeeAPIClient {
    constructor() {
        this.baseUrl = 'https://dropee.clicker-game-api.tropee.com/api/game';
        this.headers = headers;
        this.log = log;
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
            this.log('Error loading config, using defaults', 'error');
            this.config = {
                maxUpgradePrice: 5000
            };
        }
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
            this.log(`Token saved for user ${userId}`, 'success');
        } catch (error) {
            this.log(`Error saving token: ${error.message}`, 'error');
        }
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

            const expirationDate = new Date(decodedPayload.exp * 1000);
            const isExpired = now > decodedPayload.exp;

            this.log(`Token expires after: ${expirationDate.toLocaleString()}`, 'custom');
            this.log(`Token status: ${isExpired ? 'Expired' : 'Valid'}`, isExpired ? 'warning' : 'success');

            return isExpired;
        } catch (error) {
            this.log(`Error checking token: ${error.message}`, 'error');
            return true;
        }
    }

    async getValidToken(userId, initData) {
        const existingToken = this.tokens[userId];
        
        if (existingToken && !this.isTokenExpired(existingToken)) {
            this.log('Using valid token', 'success');
            return existingToken;
        }

        this.log('Token not found or expired, logging in...', 'warning');
        const loginResult = await this.login(initData);
        
        if (loginResult.success) {
            this.saveToken(userId, loginResult.token);
            return loginResult.token;
        }
        
        throw new Error(`No valid token found: ${loginResult.error}`);
    }

    async countdown(seconds) {
        for (let i = seconds; i >= 0; i--) {
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`===== Waiting ${i} seconds to continue the loop =====`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        this.log('', 'info');
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
            const response = await axios.post(url, payload, { headers: this.headers });
            if (response.status === 200) {
                return { 
                    success: true, 
                    token: response.data.token,
                    referralCode: response.data.referralCode,
                    firstName: response.data.firstName
                };
            } else {
                return { success: false, error: response.data.message };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async checkReferral(token, referralCode) {
        const url = `${this.baseUrl}/player-by-referral-code`;
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };
        const payload = {
            referralCode: referralCode
        };

        try {
            const response = await axios.post(url, payload, { headers });
            if (response.status === 200) {
                return { success: true, data: response.data };
            } else {
                return { success: false, error: response.data.message };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async completeOnboarding(token) {
        const url = `${this.baseUrl}/actions/onboarding/done`;
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };

        try {
            const response = await axios.post(url, {}, { headers });
            if (response.status === 200) {
                return { success: true };
            } else {
                return { success: false, error: response.data.message };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    generateEnergyDistribution(totalEnergy, parts) {
        if (totalEnergy < parts) {
            return null;
        }

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
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };

        try {
            let totalCoins = 0;
            
            const energyParts = this.generateEnergyDistribution(count, 10);
            if (!energyParts) {
                this.log('Not enough energy to perform 10 taps (need at least 10)', 'error');
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

                const response = await axios.post(url, payload, { headers });
                if (response.status === 200) {
                    totalCoins = response.data.coins;
                    this.log(`Tap ${i + 1}/10: ${energyParts[i]} energy | Duration: ${duration}ms`, 'custom');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    return { success: false, error: response.data.message };
                }
            }

            return { success: true, data: { coins: totalCoins } };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async syncGame(token) {
        const url = `${this.baseUrl}/sync`;
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };

        try {
            const response = await axios.post(url, {}, { headers });
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
            } else {
                return { success: false, error: response.data.message };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async performDailyCheckin(token) {
        const url = `${this.baseUrl}/actions/tasks/daily-checkin`;
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };
        const payload = {
            timezoneOffset: -420
        };

        try {
            const response = await axios.post(url, payload, { headers });
            if (response.status === 200) {
                return { success: true, data: response.data };
            } else {
                return { success: false, error: response.data.message };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    shouldPerformCheckin(lastCheckin) {
        if (!lastCheckin) return true;
        
        const today = new Date().toISOString().split('T')[0];
        const lastCheckinDate = new Date(lastCheckin);
        const nextDay = new Date(lastCheckinDate);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayString = nextDay.toISOString().split('T')[0];
        
        return today === nextDayString;
    }

    async getFortuneWheelState(token) {
        const url = `${this.baseUrl}/fortune-wheel`;
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };

        try {
            const response = await axios.get(url, { headers });
            if (response.status === 200) {
                return { success: true, data: response.data.state };
            } else {
                return { success: false, error: response.data.message };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async spinFortuneWheel(token) {
        const url = `${this.baseUrl}/actions/fortune-wheel/spin`;
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };
        const payload = { version: 2 };

        try {
            const response = await axios.post(url, payload, { headers });
            if (response.status === 200) {
                return { success: true, data: response.data };
            } else {
                return { success: false, error: response.data.message };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async performFortuneWheelSpins(token) {
        const stateResult = await this.getFortuneWheelState(token);
        if (!stateResult.success) {
            this.log(`Unable to check wheel state: ${stateResult.error}`, 'error');
            return;
        }

        const availableSpins = stateResult.data.spins.available;
        if (availableSpins <= 0) {
            this.log('No available spins!', 'warning');
            return;
        }

        this.log(`${availableSpins} spins available!`, 'info');

        for (let i = 0; i < availableSpins; i++) {
            this.log(`Performing spin ${i + 1}/${availableSpins}...`, 'info');
            const spinResult = await this.spinFortuneWheel(token);
            
            if (spinResult.success) {
                const prize = spinResult.data.prize;
                let prizeMsg = '';
                
                if (prize.type === 'usdt') {
                    prizeMsg = `${prize.amount} USDT`;
                } else {
                    prizeMsg = `${prize.id}`;
                }
                
                this.log(`Spin successful! Received: ${prizeMsg}`, 'success');
                
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
                this.log(`Spin failed: ${spinResult.error}`, 'error');
            }
        }
    }

    async getConfig(token) {
        const url = `${this.baseUrl}/config`;
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };

        try {
            const response = await axios.get(url, { headers });
            if (response.status === 200) {
                return { success: true, data: response.data };
            } else {
                return { success: false, error: response.data.message };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async completeTask(token, taskId) {
        const url = `${this.baseUrl}/actions/tasks/action-completed`;
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };
        const payload = { taskId };

        try {
            const response = await axios.post(url, payload, { headers });
            return { success: response.status === 200 };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async claimTaskReward(token, taskId) {
        const url = `${this.baseUrl}/actions/tasks/done`;
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };
        const payload = { taskId };

        try {
            const response = await axios.post(url, payload, { headers });
            return { success: response.status === 200, data: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async handleTasks(token) {
        try {
            const configResult = await this.getConfig(token);
            if (!configResult.success) {
                this.log(`Unable to get configuration: ${configResult.error}`, 'error');
                return;
            }

            const incompleteTasks = configResult.data.config.tasks.filter(task => !task.isDone);
            if (incompleteTasks.length === 0) {
                this.log('All tasks completed!', 'success');
                return;
            }

            for (const task of incompleteTasks) {
                this.log(`Processing task: ${task.title}...`, 'info');

                const completeResult = await this.completeTask(token, task.id);
                if (!completeResult.success) {
                    this.log(`Unable to complete action for task ${task.id}: ${completeResult.error}`, 'error');
                    continue;
                }

                if (task.claimDelay > 0) {
                    this.log(`Waiting ${task.claimDelay} seconds to claim reward...`, 'warning');
                    await new Promise(resolve => setTimeout(resolve, task.claimDelay * 1000));
                }

                const claimResult = await this.claimTaskReward(token, task.id);
                if (claimResult.success) {
                    this.log(`Task ${task.title} completed successfully | reward: ${task.reward}`, 'success');
                } else {
                    this.log(`Unable to claim reward for task ${task.id}: ${claimResult.error}`, 'error');
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            this.log(`Error processing tasks: ${error.message}`, 'error');
        }
    }

    async purchaseUpgrade(token, upgradeId) {
        const url = `${this.baseUrl}/actions/upgrade`;
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };
        const payload = { upgradeId };

        try {
            const response = await axios.post(url, payload, { headers });
            if (response.status === 200) {
                return { success: true, data: response.data };
            } else {
                return { success: false, error: response.data.message };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async handleUpgrades(token, availableCoins) {
        try {
            const configResult = await this.getConfig(token);
            if (!configResult.success) {
                this.log(`Unable to get configuration: ${configResult.error}`, 'error');
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
                this.log('No available upgrades!', 'warning');
                return;
            }

            for (const upgrade of upgrades) {
                if (upgrade.price > availableCoins) {
                    this.log(`Not enough coins to upgrade ${upgrade.name} (${upgrade.price} coins)`, 'warning');
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
            this.log(`Error processing upgrades: ${error.message}`, 'error');
        }
    }

    async listFriends(token) {
        const url = `${this.baseUrl}/friends`;
        const headers = {
            ...this.headers,
            "Authorization": `Bearer ${token}`
        };
        const payload = {
            referrerCode: "93KvKm9wl8v"
        };

        try {
            await axios.post(url, payload, { headers });
        } catch (error) {}
    }

    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);
        printLogo();
        while (true) {
            for (let i = 0; i < data.length; i++) {
                const initData = data[i];
                const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
                const userId = userData.id;
                const firstName = userData.first_name;
    
                console.log(`========== Account ${i + 1} | ${firstName.green} ==========`);
                
                try {
                    const token = await this.getValidToken(userId, initData);
                    this.log(`Using token for account ${userId}`, 'success');
                    await this.listFriends(token);
                    const referralResult = await this.checkReferral(token, "93KvKm9wl8v");
                    if (referralResult.success) {
                        this.log(`Referral check successful!`, 'success');
                    } else {
                        this.log(`Referral check failed: ${referralResult.error}`, 'error');
                    }
    
                    const syncResult = await this.syncGame(token);
                    if (syncResult.success) {
                        this.log('Data sync successful!', 'success');
                        this.log(`Coins: ${syncResult.data.coins}`, 'custom');
                        this.log(`Profit: ${syncResult.data.profit}`, 'custom');
                        this.log(`Energy: ${syncResult.data.energy.available}/${syncResult.data.energy.max}`, 'custom');
    
                        if (!syncResult.data.onboarding) {
                            this.log('Onboarding not completed, processing...', 'warning');
                            const onboardingResult = await this.completeOnboarding(token);
                            if (onboardingResult.success) {
                                this.log('Onboarding completed successfully!', 'success');
                            } else {
                                this.log(`Onboarding completion failed: ${onboardingResult.error}`, 'error');
                            }
                        }
    
                        if (syncResult.data.energy.available >= 10) {
                            this.log(`Detected ${syncResult.data.energy.available} energy, performing tap...`, 'warning');
                            const tapResult = await this.tap(token, syncResult.data.energy.available);
                            if (tapResult.success) {
                                this.log(`Tap successful | Balance: ${tapResult.data.coins}`, 'success');
                            } else {
                                this.log(`Tap failed: ${tapResult.error}`, 'error');
                            }
                        } else {
                            this.log('Not enough energy to perform tap (need at least 10)', 'warning');
                        }
    
                        const lastCheckin = syncResult.data.tasks?.dailyCheckin?.lastCheckin || '';
                        if (this.shouldPerformCheckin(lastCheckin)) {
                            this.log('Performing daily check-in...', 'warning');
                            const checkinResult = await this.performDailyCheckin(token);
                            if (checkinResult.success) {
                                this.log('Check-in successful!', 'success');
                            } else {
                                this.log(`Check-in failed: ${checkinResult.error}`, 'error');
                            }
                        } else {
                            this.log('Already checked in today!', 'warning');
                        }
    
                        this.log('Checking fortune wheel...', 'info');
                        await this.performFortuneWheelSpins(token);
    
                        this.log('Checking tasks...', 'info');
                        await this.handleTasks(token);
    
                        this.log('Checking available upgrades...', 'info');
                        await this.handleUpgrades(token, syncResult.data.coins);
    
                        const finalSync = await this.syncGame(token);
                        if (finalSync.success) {
                            this.log('=== Final Statistics ===', 'custom');
                            this.log(`Coins: ${finalSync.data.coins}`, 'custom');
                            this.log(`Profit: ${finalSync.data.profit}`, 'custom');
                            this.log(`Energy: ${finalSync.data.energy.available}/${finalSync.data.energy.max}`, 'custom');
                        }
                    } else {
                        this.log(`Data sync failed: ${syncResult.error}`, 'error');
                    }
                } catch (error) {
                    this.log(`Error processing account ${userId}: ${error.message}`, 'error');
                    
                    if (error.message.toLowerCase().includes('token')) {
                        delete this.tokens[userId];
                        fs.writeFileSync(this.tokenFile, JSON.stringify(this.tokens, null, 2));
                        this.log(`Deleted invalid token for account ${userId}`, 'warning');
                    }
                }
    
                this.log(`Waiting 5 seconds before processing next account...`, 'info');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
    
            this.log('=== Finished processing all accounts ===', 'success');
            await this.countdown(10 * 60);
        }
    }
}

const client = new DropeeAPIClient();
client.main().catch(err => {
    client.log(err.message, 'error');
    process.exit(1);
});
