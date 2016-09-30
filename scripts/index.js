(function(_this) {
    'use strict';

    var defaultGasLimit = 300000;

    // This is set to false during flatten.py
    var DEBUG = true;

    if (window.parent !== window) {
        console.log('ethers.io cannot be run inside another frame (yet) for security reasons');
        alert('Security Violation Error: Cannot run ethers.io inside a frame');
        Array.prototype.forEach.call(document.body.children, function(el) {
            el.remove();
        });

        var div = document.createElement('div');
        div.classList.add('violation');
        div.textContent = 'Security Violation: Cannot run ethers.io inside a frame';
        document.body.appendChild(div);

        throw new Error('security violation');
    }

    var testnet = null;
    var provider = null;

    // If you are working on a local copy (ie. making changes to ethers.io core) you
    // can adjust your target network here. Otherwise, the production environment
    // uses the serving domain to figure out which network to connect to.
    if (DEBUG) {

        // Change this (if you wish)
        testnet = true;
        var local = false;

        if (testnet) {
            if (local) {
                provider = new Wallet.providers.EthersProvider('ws://localhost:5000/v2/morden');
            } else {
                provider = new Wallet.providers.EthersProvider('wss://linode-newark.ethers.ws:5000/v2/morden');
            }

        } else {
            if (local) {
                provider = new Wallet.providers.EthersProvider('ws://localhost:5000/v2/homestead');
            } else {
                provider = new Wallet.providers.EthersProvider('wss://linode-newark.ethers.ws:5001/v2/homestead');
            }
        }

        if (!provider) {
            provider = new Wallet.providers.EthersProvider('wss://linode-newark.ethers.ws:5000/v2/morden');
        }

    } else {

        // The flatten.py script sets DEBUG to false, so this will be entered in production

        // Any domain other than "ethers.io" will be testnet
        testnet = (location.hostname !== 'ethers.io');
        if (testnet) {
            provider = new Wallet.providers.EthersProvider('wss://linode-newark.ethers.ws:5000/v2/morden');
        } else {
            provider = new Wallet.providers.EthersProvider('wss://linode-newark.ethers.ws:5001/v2/homestead');
        }
    }

    console.log('Network: ' + (testnet ? 'morden': 'homestead'));

    utils.defineProperty(_this, 'isTestnet', testnet);

    var settings = new utils.Store('ethers.io-settings');

    /**
     *   Accounts
     */
    var accounts = (function() {

        var accounts = {};
        var activeAccount = null;

        utils.defineEventEmitter(accounts);

        // Ensure we don't create accounts that already exist
        var accountCache = {};

        var prefix = 'ethers.io-account-';
        var extendedPrefix = 'x-ethers.io-account-';

        var wallets = {};

        function getAccountStore(account) {
            return new utils.Store(extendedPrefix + account.address);
        }

        function Account(json) {
            if (!(this instanceof Account)) { throw new Error('missing new'); }

            var data = JSON.parse(json);

            utils.defineProperty(this, 'address', Wallet.getAddress(data.address));
            utils.defineProperty(this, 'json', data.json);

            utils.defineProperty(this, 'createdDate', data.createdDate);
            utils.defineProperty(this, 'method', data.method);

            var store = getAccountStore(this);

            Object.defineProperty(this, 'nickname', {
                enumerable: true,
                get: function() { return store.get('nickname'); },
                set: function(value) {
                    if (typeof(value) !== 'string') { throw new Error('invalid nickname'); }
                    store.set('nickname', value);
                    if (activeAccount === this) {
                        accounts.emit('activeChange', this, this);
                    }
                }
            });

            Object.defineProperty(this, 'balance', {
                enumerable: true,
                get: function() { return new Wallet.utils.BN(store.get('balance') || '0'); }
            });
        }

        utils.defineProperty(Account.prototype, 'sign', function(transaction) {
            var wallet = wallets[this.address];
            if (!wallet) { throw new Error('account locked'); }
            return wallet.sign(transaction);
        });

        utils.defineProperty(Account.prototype, 'lock', function() {
            delete wallets[this.address];
        });

        utils.defineProperty(Account.prototype, 'unlock', function(password, progressCallback) {
            var self = this;
            return new Promise(function(resolve, reject) {
                Wallet.decrypt(self.json, password, progressCallback).then(function(wallet) {
                     if (wallet.address !== self.address) {
                         reject('fatal internal error...');
                         return;
                     }
                     wallets[self.address] = wallet;
                     resolve(self);
                }, function(error) {
                    reject(error);
                });
            });
        });

        Object.defineProperty(Account.prototype, 'locked', {
            enumerable: true,
            get: function() { return (wallets[this.address] == null); }
        });

        utils.defineProperty(Account.prototype, 'remove', function() {
            localStorage.removeItem(prefix + this.address);
            delete accountCache[this.address];
            delete wallets[this.address];

            if (this === activeAccount) {
                var targetAccount = null;
                accounts.forEach(function(account) {
                    if (targetAccount === null) {
                        targetAccount = account;
                    }
                });

                accounts.activeAccount = targetAccount;
            }
        });


        var methods = {created: true, imported: true};
        function createAccount(json, wallet, method) {
            var key = prefix + wallet.address;
            if (localStorage.getItem(key)) {
                throw new Error('account already exists');
            }

            if (!methods[method]) { throw new Error('invalid method'); }
            var data = {
                address: wallet.address,
                createdDate: (new Date()).getTime(),
                json: json,
                method: method,
                version: 1,
            }
            localStorage.setItem(key, JSON.stringify(data));

            wallets[wallet.address] = wallet;

            var account = accounts.get(wallet.address);
            if (!activeAccount) {
                accounts.activeAccount = account;
            }

            provider.watchAccount(account.address);

            return account;
        }
        utils.defineProperty(accounts, 'create', createAccount);

        function listAccounts() {
            var keys = [];
            for (var key in localStorage) {
                if (key.substring(0, prefix.length) !== prefix) { continue; }
                keys.push(key.substring(prefix.length));
            }

            // Always return a canonical and stable order for a given set
            keys.sort();

            return keys;
        }

        Object.defineProperty(accounts, 'length', {
            enumerable: true,
            get: function() { return listAccounts().length; }
        });

        utils.defineProperty(accounts, 'get', function(address) {
            address = Wallet.getAddress(address);
            if (!accountCache[address]) {
                var json = localStorage.getItem(prefix + address);
                if (!json) { return null; }
                accountCache[address] = new Account(json);
            }
            return accountCache[address];
        });

        utils.defineProperty(accounts, 'item', function(index) {
            return accounts.get(listAccounts()[index]);
        });

        utils.defineProperty(accounts, 'forEach', function(callback) {
            var sorted = [];
            listAccounts().forEach(function(address) {
                sorted.push(accounts.get(address));
            });

            // Sort by date
            sorted.sort(function(a, b) {
                return (a.createdDate - b.createdDate);
            });

            sorted.forEach(function(account) {
                callback(account);
            });

            return sorted.length;
        });

        // If we have an active account from a previous session, use it.
        try {
            activeAccount = accounts.get(settings.get('activeAddress'));
        } catch (error) { }

        Object.defineProperty(accounts, 'activeAccount', {
            enumerable: true,
            get: function() { return activeAccount; },
            set: function(value) {
                if (value !== null && !(value instanceof Account)) {
                    throw new Error('invalid activeAccount');
                }

                var oldActiveAccount = activeAccount;

                var address = null;
                if (value) { address = value.address; }
                settings.set('activeAddress', address);

                activeAccount = value;

                accounts.emit('activeChange', activeAccount, oldActiveAccount);
            }
        });

        accounts.forEach(function(account) {
            provider.watchAccount(account.address);
        });

        provider.onaccount = function(address, info) {
            var account = accounts.get(address);
            if (!account) { return; }

            var changed = false;

            var accountStore = getAccountStore(account);
            if (info.balance) {
                var balance = info.balance.toString(10);
                if (balance !== accountStore.get('balance')) {
                    accountStore.set('balance', balance);
                    changed = true;
                }
            }

            if (changed) { accounts.emit('balanceChange', account); }
        }

        return accounts;
    })();

    if (DEBUG) {
        console.warn('Debug mode active; exposing some internal variables');
        _this.debugAccounts = accounts;
        _this.debugSettings = settings;
        _this.debugProvider = provider;
    }

    function normalizePassword(password) {
        return new Wallet.utils.Buffer(password.normalize('NFKC'), 'utf8');
    }

    function formatEther(amountWei) {
        var text = Wallet.formatEther(amountWei, {commify: true});
        var comps = text.split('.');
        if (comps[1].length > 5) { comps[1] = comps[1].substring(0, 5); }
        return comps.join('.');
    }

    function getNickname(prefix) {
        var nicknames = {};
        accounts.forEach(function(account) {
            nicknames[account.nickname] = true;
        });

        var suffix = 0;
        while (true) {
            var nickname = prefix;
            if (suffix++) { nickname += (' #' + suffix); }
            if (!nicknames[nickname]) { return nickname; }
        }
    }

    // @TODO: add ensureAddress, etc. with name
    function ensureString(value, name) {
        if (typeof(value) !== 'string') {
            throw new Error('invalid ' + (name ? name: 'string'));
        }
        return value;
    }

    function ensureHexString(value, length, name) {
        if (typeof(value) !== 'string' || !value.match(/0x[0-9A-Fa-f]*/)) {
            throw new Error('invalid ' + (name ? name: 'value' + ': ' + value));
        }
        if (length != null && value.length != (2 + 2 * value.length)) {
            throw new Error('wrong length ' + (name ? name: 'value') + ': ' + value);
        }
        return value;
    }

    function ensureInteger(value, name) {
        if (typeof(value) !== 'number' || parseInt(value) !== value || value < 0) {
            throw new Error('invalid ' + (name ? name: 'value'));
        }
        return value;
    }

    function checkTransaction(transaction) {
        var result = {};

        ['to', 'from'].forEach(function(key) {
            var value = transaction[key];
            if (!value) { return; }
            result[key] = Wallet.getAddress(value);
        });

        ['data', 'gasPrice', 'gasLimit', 'nonce', 'value'].forEach(function(key) {
            var value = transaction[key];
            if (value == null) { return; }
            if (typeof(value) === 'string' && value.match(/0x[0-9A-Fa-f]*/)) {
                result[key] = value
            } else if (typeof(value) === 'number' && parseInt(value) === value) {
                result[key] = value
            } else if (value instanceof Wallet.utils.BN) {
                result[key] = new Wallet.utils.BN(value);
            } else {
                throw new Error('invalid entry');
            }
        });

        return result;
    }

    var divLogo = utils.get('#logo');
    //var pendingBounces = 0;
    var bouncing = false;
    function bounceLogo() {
        if (bouncing) {
            //pendingBounces++;
            return;
        }

        bouncing = true;
        divLogo.classList.add('animate');
        setTimeout(function() {
            divLogo.classList.remove('animate');
            setTimeout(function() {
                bouncing = false;
                //if (pendingBounces) {
                //    pendingBounces--;
                //    bounceLogo();
                //}
            }, 1000);
        }, 2000);
    }
    //setInterval(bounceLogo, 1100);
    utils.defineProperty(_this, 'bounceLogo', bounceLogo);

    // Validates text input and calls the callback on enter with the value
    function setupInput(template, inputBoxClass, callback, checkFunction) {
        var selectorPrefix = 'div.input-box.' + inputBoxClass + ' ';
        var input = utils.get(template, selectorPrefix + 'input');
        var checkOk = utils.get(template, selectorPrefix + '.input-check .ok');
        var checkNotOk = utils.get(template, selectorPrefix + '.input-check .not-ok');
        var spanBubble = utils.get(template, selectorPrefix + '.input-check .bubble');

        // Validate the input as they type
        function oninput() {
            var message = checkFunction(input.value);

            if (input.value === '' || message === null) {
                checkOk.style.opacity = '0';
                checkNotOk.style.opacity = '0';
            } else if (message) {
                checkOk.style.opacity = '0';
                checkNotOk.style.opacity = '1';
                spanBubble.textContent = message;
            } else {
                checkOk.style.opacity = '1';
                checkNotOk.style.opacity = '0';
            }
            // @TODO: Stir the randomish
        }
        input.oninput = oninput;
        oninput();

        // Detect the enter key
        input.onkeyup = function(event) {
            if (event.which !== 13) { return; }
            var value = checkFunction(input.value);
            if (value === '' || value === null) {
                callback(input.value);
            }
        }

        return input;
    }
    // SECURITY NOTE: NEVER pass in untrusted HTML to message
    function modalPushDownload(title, checkCallback) {
        return new Promise(function(resolve, reject) {
            var template = Modal.push('verify-download', function(content) {
                if (checkCallback(content)) {
                    template.onpurge = null;
                    resolve(content);
                }
            });
            template.onpurge = function() { reject(new Error('purged')); }

            utils.get(template, '.header').textContent = title;

            utils.get(template, '.cancel').onclick = function() {
                template.onpurge = null;
                reject(new Error('cancelled'));
            }
        });
    }

    // SECURITY NOTE: NEVER pass in untrusted HTML to message
    function modalPushPassword(title, message, placeholder, checkCallback) {
        var template = Modal.push('password');

        var promise = new Promise(function(resolve, reject) {
            template.onpurge = function() { reject(new Error('purged')); }

            utils.get(template, '.header').textContent = title;
            utils.get(template, 'p').innerHTML = message;
            utils.get(template, 'input').setAttribute('placeholder', placeholder);

            var input = setupInput(template, 'password', function(value) {
                template.onpurge = null;
                resolve(value);
            }, checkCallback);

            Modal.resize();

            // Prevents flickering the screen while animating a newly focused item
            setTimeout(function() { input.focus(); }, 100);

            utils.get(template, '.cancel').onclick = function() {
                template.onpurge = null;
                reject(new Error('cancelled'));
            }
        });
        utils.defineProperty(promise, 'template', template);

        return promise;
    }

    // SECURITY NOTE: NEVER pass in untrusted HTML to message
    // startCallback should return a promise
    function modalPushProgress(title, message, startCallback) {
        var template = Modal.push('progress');

        var progressBar = utils.get(template, '.progress .bar');
        var progressStatus = utils.get(template, '.progress .status span');

        utils.get(template, '.header').textContent = title;
        utils.get(template, 'p').innerHTML = message;

        Modal.resize();

        var promise = new Promise(function(resolve, reject) {
            template.onpurge = function() { reject(new Error('purged')); }

            var stopped = false;
            utils.get(template, '.cancel').onclick = function() {
                stopped = true;
                progressBar.style.opacity = '0.5';
                progressStatus.textContent = 'cancelling';
                setTimeout(function() {
                    template.onpurge = null;
                    reject(new Error('cancelled'))
                }, 1000);
            }

            var lastProgress = -2;
            function update(progress) {
                if (stopped) { return true; }
                if (progress === 1) {
                    progressBar.classList.add('complete');
                }
                if (progress > lastProgress + (0.0025) || progress === 1) {
                    lastProgress = progress;
                    progressBar.style.width = (6 + 94 * progress) + '%';
                    progressStatus.textContent = parseInt(100 * progress) + '%';
                }
            }

            startCallback(update).then(function(result) {
                template.onpurge = null;
                resolve(result);
            }, function(error) {
                template.onpurge = null;
                reject(error);
            });
        });
        utils.defineProperty(promise, 'template', template);
        return promise;
    }

    function modalPushUnlock(account) {
        return new Promise(function(resolve, reject) {
            modalPushPassword(
               'Unlock Account',
               'To send transactions, you must first unlock your account.',
               '(account password)',
               function(password) { return null; }
            ).then(function(password) {
               function startProcess(updateProgress) {
                   return account.unlock(normalizePassword(password), updateProgress)
               }

               modalPushProgress(
                   'Unlocking Account',
                   'Please wait while we decrypt your wallet.',
                   startProcess
               ).then(function(account) {
                   Modal.notify('Unlock Account', 'Your account has successfully been unlocked.');
                   utils.forEach('.lock-status', function(el) {
                       if (el._updateLockStatus) { el._updateLockStatus(); }
                   });
                   resolve(account);

               }, function(error) {
                   if (error.message === 'invalid password') {
                       Modal.notify('Unlock Account', 'Your password was incorrect, please try again.');
                       Modal.pop();

                    } else if (error.message === 'cancelled') {
                       Modal.notify('Unlock Account', 'Cancelled.');
                       reject(error);

                    } else {
                       console.log(error);
                       Modal.notify('Unlock Account', 'Unknown error \u2014 ' + error.message);
                       reject(error);
                   }
               });

            }, function(error) {
                reject(error)
            });
        });
    }

    function modalPushTransaction(account, transaction, estimateFee, buttonTitle, callback) {
        var formattedData = '';
        if (transaction.data) {
            var data = transaction.data.substring(2);
            while (data.length) {
                formattedData += data.substring(0, 16) + ' ';
                data = data.substring(32);
            }
        }

        var template = Modal.push('confirm-send');
        var spanEstimateFee = utils.get(template, '.estimate-fee');
        var divButton = utils.get(template, '.button');

        utils.get(template, '.amount').textContent = Wallet.formatEther(transaction.value || '0x00');
        utils.get(template, '.from-nickname').textContent = account.nickname;
        utils.get(template, '.from-address').textContent = account.address;

        if (transaction.to) {
            utils.get(template, '.to-address').textContent = transaction.to;
            utils.get(template, '.to-icap-address').textContent = '(' + Wallet.getIcapAddress(transaction.to) + ')';

        } else {
            utils.get(template, '.to-address').textContent = '(calculating...)';
            estimateFee.then(function(results) {
                var address = Wallet.utils.getContractAddress({
                    from: account.address,
                    nonce: results[2]
                });
                utils.get(template, '.to-address').textContent = address;
            }, function(error) {
                console.log(error);
            });
            utils.get(template, '.to-icap-address').textContent = '(new contract address)';
        }

        divButton.textContent = buttonTitle;

        if (formattedData) {
            utils.get(template, 'span.data').textContent = formattedData;
        } else {
            utils.get(template, 'tr.data').style.display = 'none';
        }

        Modal.resize();

        //return new Promise(function(resolve, reject) {
            template.onpurge = function() { callback(new Error('purged')); }

            divButton.onclick = function() {
                if (divButton.classList.contains('disabled')) { return; }
                template.onpurge = null;
                callback(null);
            }

            utils.get(template, '.cancel').onclick = function() {
                template.onpurge = null;
                callback(new Error('cancelled'));
            }

            estimateFee.then(function(results) {
                var gasPrice = results[0];
                var estimatedGas = results[1];
                var transactionCount = results[2];

                var feeWei = gasPrice.mul(estimatedGas);
                spanEstimateFee.textContent = '(estimated fee \u2014 ' + Wallet.formatEther(feeWei) + ')';
                spanEstimateFee.classList.remove('glow');

                transaction.gasPrice = gasPrice;
                transaction.nonce = transactionCount;

                divButton.classList.remove('disabled');

            }, function(error) {
                console.log(error);
                spanEstimateFee.textContent = '(there was an error fetching the estimated fee)';
                spanEstimateFee.classList.remove('glow');
            });
        //});
    }

    function modalPushDeployContract(account, contract) {
        var transaction = {
            data: contract.bytecode,
        }

        return modalPushSendTransaction(account, transaction);
    }

    // After the promise resolves, the transaction will have been populated
    // with any missing fields (from, gasLimit, gasPrice
    function modalPushSendTransaction(account, transaction, skipPreview) {
        //transaction = checkTransaction(transaction);

        // Override any from given
        transaction.from = account.address;

        // Set a reasonable gas limit if not present
        if (transaction.gasLimit == null) {
            transaction.gasLimit = defaultGasLimit;
        }

        // Get the required network parameters to populate the transaction
        var estimateFee = new Promise(function(resolve, reject) {
            Promise.all([
                provider.getGasPrice(),
                provider.estimateGas(transaction),
                provider.getTransactionCount(account.address, 'pending'),
            ]).then(function(results) {
                resolve(results);
            }, function(error) {
                reject(error);
            });
        });


        return new Promise(function(resolve, reject) {

            function executeSend(transaction) {
                var template = Modal.push('sending');
                template.onpurge = function() { reject(new Error('purged')); }

                //console.log('SEND', transaction);
                var signedTransaction = account.sign(transaction);
                provider.sendTransaction(signedTransaction).then(function(hash) {
                    Modal.disable();
                    setTimeout(function() {
                        Modal.notify('Send Transaction', 'Transaction was successfully sent.');
                        template.onpurge = null;
                        //estimateFee.then(function(results) {
                            var address = transaction.to;
                            if (!address) {
                                // By now, transaction has had the nonce populated
                                address = Wallet.utils.getContractAddress(transaction);
                                //address = Wallet.utils.getContractAddress({
                                //    from: account.address,
                                //    nonce: results[2]
                                //});
                            }
                            resolve({
                                to: address,
                                hash: hash,
                            });
                        //});
                    }, 1000);
                }, function(error) {
                    console.log(error);
                    setTimeout(function() {
                        Modal.notify('Send Transaction', 'There was an error sending this transaction.');
                        Modal.pop();
                    }, 1000);
                });
            }

            function confirm() {
                modalPushTransaction(account, transaction, estimateFee, 'CONFIRM & SEND TRANSACTION', function(error) {
                    if (error) {
                        reject(error);
                        return;
                    }

                    estimateFee.then(function(results) {
                        if (!transaction.gasPrice) {
                            transaction.gasPrice = results[0];
                        }
                        if (!transaction.nonce) {
                            transaction.nonce = results[2];
                        }
                        executeSend(transaction);
                    });
                });
            }

            function unlock() {
                modalPushUnlock(account).then(function(unlockedAccount) {
                    //console.log(account, unlockedAccount);
                    if (account !== unlockedAccount) {
                        reject(new Error('internal error'));
                        return;
                    }
                    confirm();
                }, function(error) {
                    reject(error);
                });
            }

            if (account.locked) {
                if (skipPreview) {
                    unlock();

                } else {
                    modalPushTransaction(account, transaction, estimateFee, 'UNLOCK ACCOUNT...', function(error) {
                        if (error) {
                            reject(error);
                            return;
                        }

                        unlock();
//                    }, function(error) {
//                        reject(error);
                    });
                }
            } else {
                confirm();
            }
        });
    }

    function modalPushSend(account, address, amountWei) {

        var divInspect = document.getElementById('inspect');
        function getFontSize(text, css, maxWidth, startSize) {

            var span = document.createElement('span');
            span.textContent = text;
            divInspect.appendChild(span);

            for (var key in css) { span.style[key] = css[key]; }

            var fontSize = startSize;
            while (fontSize > 10) {
                span.style.fontSize = fontSize + 'px';
                var size = utils.getSize(span);
                if (size.width <= maxWidth) { break; }
                fontSize--;
            }
            span.remove();

            return fontSize + 'px';
        }

        return new Promise(function(resolve, reject) {

            Modal.purge();
            var template = Modal.push('wallet');
            template.onpurge = function() { reject(new Error('purged')); }

            var inputAddress = utils.get(template, '.input-box.address input');
            var inputAmount = utils.get(template, '.input-box.amount input');
            var divButton = utils.get(template, '.button');

            if (address) {
                inputAddress.value = address;
            }

            if (amountWei) {
                inputAmount.value = Wallet.formatEther(amountWei);
            }

            function doSend(address, amountWei) {
                var transaction = {
                    from: account.address,
                    gasLimit: defaultGasLimit,
                    to: address,
                    value: amountWei,
                }

                modalPushSendTransaction(account, transaction, true).then(function(info) {
                    template.onpurge = null;
                    resolve(info.hash)
                }, function(error) {
                    template.onpurge = null;
                    reject(error);
                });
            }

            var validAddress = false, validAmount = false;
            function checkButton() {
                if (validAddress && validAmount) {
                    divButton.classList.remove('disabled');
                } else {
                    divButton.classList.add('disabled');
                }
            }

            function clickButton() {
                if (divButton.classList.contains('disabled')) { return; }
                doSend(Wallet.getAddress(inputAddress.value), Wallet.parseEther(inputAmount.value));
            }

            divButton.onclick = clickButton;

            setupInput(template, 'address', function(address) {
                if (validAddress) { inputAmount.focus(); }

            }, function(address) {
                var message = '';

                inputAddress.style.fontSize = getFontSize(address, {fontWeight: 'bold'}, 408 - 32 - 40, 20);
                try {
                    Wallet.getAddress(address);
                } catch (error) {
                    message = 'Invalid Address';
                }

                validAddress = (message === '');
                checkButton();

                return message;
            });

            setupInput(template, 'amount', clickButton, function(ether) {
                var message = '';

                try {
                    Wallet.parseEther(ether);
                } catch (error) {
                    message = 'Invalid amount of ether';
                }

                validAmount = (message === '');
                checkButton();

                return message;
            });

            divButton.textContent = (account.locked ? 'UNLOCK ACCOUNT...': 'SEND FUNDS...');

            utils.get(template, '.cancel').onclick = function() {
                template.onpurge = null;
                reject(new Error('cancelled'));
            }

            inputAddress.focus();
        });
    }

    function modalPushDelete(account) {
        function checkFiledrop(json) {
            if (json === account.json) { return true; }

            Modal.notify('Account Removal', 'Incorrect JSON wallet provided, please try again.');
            return false;
        }

        return new Promise(function(resolve, reject) {
            modalPushDownload('Confirm Delete Account', checkFiledrop).then(function(json) {
                account.remove();
                setTimeout(function() {
                    Modal.notify('Account Removal', 'Account successfully removed.');
                    resolve();
                }, 500);
            }, function(error) {
                reject(error);
            });
        });
    }

    // Begins the create account workflow
    function modalPushCreate() {
        function checkDownload(json, wallet) {

            function checkFiledrop(value) {
                if (value === json) { return true; }

                Modal.notify('New Account', 'Selected file does not match.');
                return false;
            }

            return new Promise(function(resolve, reject) {
                modalPushDownload('Verify Backup Wallet', checkFiledrop).then(function(json) {
                    var nickname = getNickname('ethers.io');
                    var account = accounts.create(json, wallet, 'created');
                    account.nickname = nickname;

                    resolve(json);

                }, function(error) {
                    reject(error);
                });
            });
        }

        function download(template, json, wallet) {
            return new Promise(function(resolve, reject) {
                utils.get(template, '.cancel').onclick = function() {
                    reject(new Error('cancelled'));
                }

                var progress = utils.get(template, '.progress');
                progress.style.transition = 'transform 0.3s ease-out 0.3s, opacity 0.3s linear 0.3s';

                var button = document.createElement('div');
                button.textContent = 'AGREE & DOWNLOAD WALLET';
                button.classList.add('button');
                button.style.left = progress.offsetLeft + 'px';
                button.style.opacity = '0';
                button.style.position = 'absolute';
                button.style.top = progress.offsetTop + 'px';
                button.style.transform = 'translateX(250px)';
                button.style.transition = 'transform 0.3s ease-out 0.3s, opacity 0.3s linear 0.3s';
                template.appendChild(button);

                setTimeout(function() {
                    button.style.opacity = '1';
                    button.style.transform = 'translateX(0)';

                    progress.style.opacity = '0';
                    progress.style.transform = 'translateX(-250px)';
                }, 0);

                button.onclick = function() {
                    saveAs(new Blob([json], {
                        type: "application/octet-stream"
                    }), 'wallet.json', true);
                    resolve();
                }
            });
        }

        function encryptWallet(wallet, password) {
            var title = 'Encrypting Backup Wallet';
            var message = ('There is <b>NO</b> personal data stored on <i>ethers.io</i> servers. ' +
                           'If you lose this file or forget your password, it is <b>IMPOSSIBLE</b> ' +
                           'to recover your account. If you share this file and your password, stolen ' +
                           'funds <b>CANNOT</b> be recovered. ' +
                           '<span class="warning">Keep this file and your password <u><b>safe</b></u>!</span>');

            function startProcess(updateProgress) {
                return wallet.encrypt(password, updateProgress);
            }

            return modalPushProgress(title, message, startProcess);
        }

        function confirmPassword(password) {
            return modalPushPassword(
                'Create New Account',
                'Please confirm your password.',
                '(confirm password)',
                function (confirmPassword) {
                    if (confirmPassword === password) { return ''; }
                    return 'passwords do not match';
                }
            );
        }

        function getPassword() {
            return modalPushPassword(
                'Create New Account',
                'Please choose your password, which <b>must be at least 6 characters</b> long.',
                '(choose pssword)',
                function(password) {
                    if (password.length >= 6) { return ''; }
                    return 'Your password is too short.'
                }
            );
        }

        return new Promise(function(resolve, reject) {
            getPassword().then(function(password) {
                confirmPassword(password).then(function (confirmPassword) {

                    // @TODO: Use a create method to ensure safety in low-entropy systems
                    var random = Wallet.utils.sha3(new Wallet.utils.Buffer(password));
                    var wallet = new Wallet(Wallet.randomish.randomBytes(32, random));

                    var encrypting = encryptWallet(wallet, normalizePassword(password));
                    encrypting.then(function(json) {
                        download(encrypting.template, json, wallet).then(function() {
                            checkDownload(json, wallet).then(function() {
                                resolve();
                            }, function(error) {
                                reject(error);
                            });
                        }, function(error) {
                            reject(error);
                        });
                    }, function(error) {
                        reject(error);
                    });
                }, function(error) {
                    reject(error);
                });
            }, function(error) {
                reject(error);
            });
        });
    }

    // Begins the import wallet workflow
    function modalPushImport() {
        function decryptWallet(json, password) {
            if (Wallet.isValidWallet(json)) {
                return new Promise(function(resolve, reject) {
                    function startProcess(updateProgress) {
                        return Wallet.decrypt(json, password, updateProgress);
                    }

                    modalPushProgress(
                        'Decrypt JSON Wallet',
                        'Decrypting wallet and verifying password.',
                        startProcess
                    ).then(function(wallet) {
                        resolve({
                            json: json,
                            wallet: wallet
                        });
                    }, function(error) {
                        if (error.message === 'invalid password') {
                            Modal.notify('Wallet Import', 'Incorrect password, please try again.');
                            Modal.pop();
                            return;
                        }
                        console.log(error);
                        Modal.notify('Wallet Import', 'Invalid wallet.');
                        reject(error);
                    });
                });

            } else if (Wallet.isCrowdsaleWallet(json)) {
                return new Promise(function(resolve, reject) {
                    try {
                        var wallet = Wallet.decryptCrowdsale(json, password);
                        //console.log(wallet);
                    } catch (error) {
                        if (error.message === 'invalid password') {
                            Modal.notify('Wallet Import', 'Incorrect password, please try again.');
                            Modal.pop();
                        } else {
                            console.log(error);
                            Modal.notify('Wallet Import', 'Invalid wallet.');
                            reject(error);
                        }
                        return;
                    }

                    function startProcess(updateProgress) {
                        return wallet.encrypt(password, updateProgress);
                    }

                    modalPushProgress(
                        'Convert Crowdsale Wallet',
                        'Converting and encrypting crowdsale wallet.',
                        startProcess
                    ).then(function(json) {
                        resolve({
                            json: json,
                            wallet: wallet
                        });
                    }, function(error) {
                        console.log(error);
                        Modal.notify('Wallet Import', 'Unknown error.');
                        reject(error);
                    });
                });

            } else {
                return new Promise(function(resolve, reject) {
                    reject(new Error('invaid Wallet'));
                });
            }
        }

        function checkFiledrop(value) {
            var address = null;
            if (Wallet.isCrowdsaleWallet(value)) {
                address = JSON.parse(value).ethaddr;
            } else if (Wallet.isValidWallet(value)) {
                address = JSON.parse(value).address;
            } else {
                Modal.notify('Import Wallet', 'Invalid JSON Wallet format.');
                return false;
            }

            if (accounts.get(address)) {
                Modal.notify('Import Wallet', 'Account already exists.');
                return false;
            }

            return true;
        }

        function getPassword() {
            return modalPushPassword(
                'Import JSON Wallet',
                'Please enter the password for this JSON Wallet.',
                '(enter password)',
                function(password) { return null; }
            );
        }

        return new Promise(function(resolve, reject) {
            modalPushDownload('Import JSON Wallet', checkFiledrop).then(function(json) {
                getPassword().then(function(password) {
                    decryptWallet(json, normalizePassword(password)).then(function(info) {
                        var nickname = getNickname('Imported Wallet');
                        var account = accounts.create(info.json, info.wallet, 'imported');
                        account.nickname = nickname;

                        Modal.notify('Wallet Import', 'Account successfully imported.');
                        resolve();
                    }, function(error) {
                        reject(error);
                    });
                }, function(error) {
                    reject(error);
                })
            }, function(error) {
                reject(error);
            });
        });
    }

    // Setup links
    (function() {
        utils.forEach('.link-account-create', function(el) {
            el.onclick = function() {
                Modal.purge();
                modalPushCreate().then(function(account) {
                    Modal.disable();
                    setTimeout(function() {
                        Modal.notify('New Account', 'Account successfully created.');
                        Modal.clear();
                    }, 500);

                }, function(error) {
                    if (error.message !== 'purged') { Modal.clear(); }
                });
            }
        });

        utils.forEach('.link-account-import', function(el) {
            el.onclick = function() {
                Modal.purge();
                modalPushImport().then(function(account) {
                    Modal.disable();
                    setTimeout(function() {
                        Modal.notify('New Account', 'Account successfully created.');
                        Modal.clear();
                    }, 500);

                }, function(error) {
                    if (error.message !== 'purged') { Modal.clear(); }
                });
            }
        });
    })();


    // Setup Applications
    (function() {

        function setupWallet() {
            var account = accounts.activeAccount;
            if (!account) {
                Modal.notify('Wallet', 'There is no active account.');
                return;
            }

            modalPushSend(account).then(function(hash) {
                Modal.clear();
            }, function(error) {
                if (error.message !== 'purged') { Modal.clear(); }
            });
        }

        utils.forEach('#wallet .apps .app', function(el) {
            el.onclick = function() {
                var name = el.getAttribute('name');
                if (name === 'wallet') {
                    setupWallet();
                } else {
                    var url = el.getAttribute('url');
                    //console.log(el, name, url);
                    application.load(url);

                    utils.forEach('#wallet .apps .app.selected', function(el) {
                        el.classList.remove('selected');
                    });
                    el.classList.add('selected');
                }

            }
        });
    })();


    // Setup active account interface (The top blue bar)
    (function() {
        var divWallet = document.getElementById('wallet');

        var divWithAccount = document.getElementById('with-account');
        var divWithoutAccount = document.getElementById('without-account');

        function setupAccount(account) {
            if (account) {
                divWithAccount.style.opacity = '1';
                divWithAccount.style.pointerEvents = '';
                divWithoutAccount.style.opacity = '';
                divWithoutAccount.style.pointerEvents = 'none';
                utils.forEach(wallet, '.populate-address', function(el) {
                    el.textContent = account.address;
                });
                utils.forEach(wallet, '.populate-nickname', function(el) {
                    el.textContent = account.nickname;
                });
                var amountEther = formatEther(account.balance);
                utils.forEach(wallet, '.populate-balance', function(el) {
                    el.textContent = amountEther;
                });
            } else {
                divWithAccount.style.opacity = '';
                divWithAccount.style.pointerEvents = 'none';
                divWithoutAccount.style.opacity = '1';
                divWithoutAccount.style.pointerEvents = '';
            }
        }

        function updateInterface(account) {
            setTimeout(function() {
                if (account !== accounts.activeAccount) { return; }
                if (account) {
                    divWithAccount.style.animation = 'fade-in 0.2s ease-out forwards';
                    setTimeout(function() {
                        if (account !== accounts.activeAccount) { return; }
                        divWithAccount.style.animation = '';
                    }, 200);
                } else {
                    divWithAccount.style.animation = '';
                }

                setupAccount(account);
            }, 200)
            divWithAccount.style.animation = 'fade-out 0.2s ease-out forwards';
        }

        accounts.on('activeChange', updateInterface);

        accounts.on('balanceChange', function(account) {
            Modal.notify('Account \u2014 ' + account.nickname, 'Balance has been updated: ' + Wallet.etherSymbol + '\u2009' + formatEther(account.balance));
            if (account === accounts.activeAccount) {
                updateInterface(account);
            }
        });

        setupAccount(accounts.activeAccount);
    })();


    // Setup account management (The bubble in the gear)
    (function() {


        var divAccounts = document.getElementById('accounts');
        var templateAccount = utils.get('#templates .account');
        var templateNoAccount = utils.get('#templates .no-account');


        function populateAccounts() {
            while (divAccounts.hasChildNodes()) {
                divAccounts.removeChild(divAccounts.lastChild);
            }

            var count = accounts.forEach(function(account) {
                var template = templateAccount.cloneNode(true);
                var spanValue = utils.get(template, '.label .value');
                spanValue.textContent = account.nickname;

                var iLockStatus = utils.get(template, '.lock-status')
                function updateLockStatus() {
                    iLockStatus.classList.remove(account.locked ? 'ion-unlocked': 'ion-locked');
                    iLockStatus.classList.add(account.locked ? 'ion-locked': 'ion-unlocked');
                }
                iLockStatus._updateLockStatus = updateLockStatus;
                updateLockStatus();

                iLockStatus.onclick = function() {
                    if (account.locked) {
                        Modal.purge();
                        modalPushUnlock(account).then(function() {
                            updateLockStatus();
                            setTimeout(function() {
                                Modal.clear();
                            }, 500);
                        }, function(error) {
                            if (error.message !== 'purged') { Modal.clear(); }
                        });
                    } else {
                        account.lock();
                        updateLockStatus();
                    }
                }

                if (account === accounts.activeAccount) {
                    utils.get(template, '.selectable').classList.add('selected');
                }

                var divOption = utils.get(template, '.option');
                divOption.onclick = function() {
                    if (divOption.classList.contains('selected')) { return; }
                    accounts.activeAccount = account;
                    utils.forEach(divAccounts, '.selected', function(el) {
                        el.classList.remove('selected');
                    });
                    divOption.classList.add('selected');
                }

                var input = utils.get(template, 'input');

                input.onblur = function() {
                    account.nickname = input.value;
                    spanValue.textContent = account.nickname;

                    utils.forEach(template, '.edit-on', function(el) {
                        el.style.opacity = '';
                        el.style.pointerEvents = '';
                    });
                    utils.forEach(template, '.edit-off', function(el) {
                        el.style.opacity = '';
                        el.style.pointerEvents = '';
                    });
                }

                input.onkeyup = function(event) {
                    if (event.which === 13) { input.blur(); }
                }

                utils.get(template, '.edit').onclick = function() {
                    utils.forEach(template, '.edit-on', function(el) {
                        el.style.opacity = '1';
                        el.style.pointerEvents = 'auto';
                    });
                    utils.forEach(template, '.edit-off', function(el) {
                        el.style.opacity = '0';
                        el.style.pointerEvents = 'none';
                    });

                    input.value = account.nickname;
                    input.focus();
                    if (input.setSelectionRange) {
                        input.setSelectionRange(999999, 999999);
                    }
                }

                utils.get(template, '.download').onclick = function() {
                    saveAs(new Blob([account.json], {
                        type: "application/octet-stream"
                    }), 'wallet.json', true);
                }

                utils.get(template, '.delete').onclick = function() {
                    Modal.purge();
                    modalPushDelete(account).then(function() {
                        Modal.clear();
                    }, function(error) {
                        if (error.message !== 'purged') { Modal.clear(); }
                    });
                }

                divAccounts.appendChild(template);
            });

            if (count === 0) {
                divAccounts.appendChild(templateNoAccount.cloneNode(true));
            }
        }
    /*
        function updateState() {
            var divEnableDevTools = document.getElementById('checkbox-enable-developer-tools');
            var divEnableTestnet = document.getElementById('checkbox-enable-testnet');

            if (divEnableDevTools.classList.contains('checked')) {
                
            } else {
                divEnableTestnet.classList.remove('checked');
            }
        }

        utils.forEach(document.body, '.checkbox', function(el) {
            el.onclick = function() {
                if (el.classList.contains('checked')) {
                    el.classList.remove('checked');
                } else {
                    el.classList.add('checked');
                }
            }
        });
        */
        var accountBubbleTrigger = document.getElementById('account-bubble-trigger');
        var bubble = utils.get(accountBubbleTrigger, '.bubble');

        var timer = null;

        // Show the accounts bubble
        accountBubbleTrigger.onmouseenter = function() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            populateAccounts();
            bubble.style.pointerEvents = 'auto';
            bubble.style.opacity = '1';
        };

        // Hide the accounts bubble; (after 300ms, incase of pointer drift)
        accountBubbleTrigger.onmouseleave = function() {
            timer = setTimeout(function() {
                bubble.style.pointerEvents = '';
                bubble.style.opacity = '0';
                timer = null;
            }, 300);
        };
    })();

   var application = (function() {
        var application = {};
        utils.defineEventEmitter(application);
/*
        // Valid fragment:
        // http://stackoverflow.com/questions/26088849/url-fragment-allowed-characters#26119120
        // https://tools.ietf.org/html/rfc3986#section-3.5
        var chars = ("ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
                     "abcdefghijklmnopqrstuvwxyz" +
                     "0123456789?/:@-._~!$&'()*+,;=";
*/
        //var contract = new Wallet.Cotract(address, abi);

        utils.defineProperty(application, 'encodeFragment', function(url) {
            url = encodeURI(url).replace(/#/g, '%23');
            if (url.substring(0, 8) === 'https://') {
                return '#!/app-link/' + url.substring(8);
            //} else if (url.substring(0, 7) === 'http://') {
            //    return '#!/app-link-insecure/' + url.substring(7);
            } else if (url.match(/^[A-Za-z0-9](-?[A-Za-z0-9])*$/)) {
                return '#!/app/' + url.toLowerCase();
            }

            throw new Error('invalid url');
        });

        utils.defineProperty(application, 'decodeFragment', function(fragment) {
            fragment = decodeURI(fragment).replace(/%23/g, '#');
            return new Promise(function(resolve, reject) {
                if (fragment.substring(0, 12) === '#!/app-link/') {
                    resolve('https://' + fragment.substring(12));
                //} else if (fragment.substring(0, 21) === '#!/app-link-insecure/') {
                //    resolve('http://' + fragment.substring(21));
                } else if (fragment.substring(0, 7) === '#!/app/') {
                    var nickname = new Wallet.utils.Buffer(fragment.substring(7).normalize('NFKC'));
                    Wallet.utils.scrypt(nickname, nickname, (1 << 15), 1, 1, 32, function(error, progress, key) {
                        if (!key) { return; };
                        key = new Wallet.utils.Buffer(key).toString('hex');
                        resolve(key);
                    });
                } else {
                    reject('invalid fragment');
                }
            });
        });

        var setName = utils.defineReadValue(application, 'name');
        var setId = utils.defineReadValue(application, 'id');
        var setOrigin = utils.defineReadValue(application, 'origin');
        var setUrl = utils.defineReadValue(application, 'url');
        var setReady = utils.defineReadValue(application, 'ready');

        var divApp = document.getElementById('app');
        var divLoadingSpinner = document.getElementById('loading-spinner');

        var setLocation = (function() {
            var spanLocation = document.getElementById('status-location');
            var inputLocation = document.getElementById('status-input-location');

            function setDisplay() {
                if (spanLocation.textContent) {
                    spanLocation.style.display = 'inline-block';
                    inputLocation.style.display = 'none';
                } else {
                    spanLocation.style.display = 'none';
                    inputLocation.style.display = 'inline-block';
                }
            }

            spanLocation.onclick = function() {
                spanLocation.style.display = 'none';
                inputLocation.style.display = 'inline-block';
                inputLocation.value = spanLocation.textContent;
                setTimeout(function() {
                    inputLocation.focus();
                }, 0);
            }

            inputLocation.onblur = function() {
                inputLocation.value = '';
                setDisplay();
            }

            inputLocation.onkeyup = function(event) {
                if (event.which !== 13) { return; }
                if (inputLocation.value) {
                    try {
                        application.load(inputLocation.value);
                    } catch (error) {
                        console.log(error);
                        Modal.notify('Application URL', 'Sorry, that URL is invalid.');
                        spanLocation.textContent = inputLocation.value;
                    }
                } else {
                    application.terminate();
                    spanLocation.textContent = '';
                }

                setDisplay();

                inputLocation.blur();
            }

            setDisplay();

            function setLocation(url) {
                if (url == null) { url = ''; }
                spanLocation.textContent = url;
                setDisplay();
                location.href = location.href.split('#')[0] + application.encodeFragment(url);
            }

            return setLocation;
        })();


        var iframeApp = null;

        var lastAccountSent = null;
        var lastBlockNumberSent = -1;

        // Maps eventId => {filterId: filterId}
        var nextEventId = 1;
        var events = {};

        function purgeEvents() {
            // @TODO: Tear down events
        }


        var nextAppId = 1;

        utils.defineProperty(application, 'load', function(url) {
            console.log('Loading Application: ' + url);

            divLoadingSpinner.classList.add('showing');
            divApp.style.opacity = '0';

            if (iframeApp) { iframeApp.remove(); }
            purgeEvents();

            iframeApp = document.createElement('iframe');
            divApp.appendChild(iframeApp);

            lastBlockNumberSent = -1;
            lastAccountSent = null;

            var origin = (url.match(/(https?:\/\/[^\/]*)/) || [null])[0];
            if (!origin) {
                console.log('Bad URL:', url);
                throw new Error('invalid url');
            }

            setId(nextAppId++);
            setUrl(url);
            setOrigin(origin);
            setReady(false);

            setTimeout(function() {
                iframeApp.src = application.url;
            }, 0);
            setName(origin);
            setLocation(application.url);
        });

        utils.defineProperty(application, 'terminate', function() {
            if (iframeApp) {
                iframeApp.remove();
                iframeApp = null;
            }

            divApp.style.opacity = '0';

            purgeEvents();

            setId(null);
            setName(null);
            setReady(false);
            setUrl(null);
        });


        function _send(payload) {
            payload.ethers = 'v\x01\n';
            iframeApp.contentWindow.postMessage(payload, application.url);
        }

        window.addEventListener('message', function(event) {
            // Make sure we are coming from the correct application
            if (!iframeApp || event.source !== iframeApp.contentWindow) {
                return;
            }

            // The application that received this message
            var appId = application.id;

            function send(payload) {
                // If we have changed applications, squelch this message
                if (application.id !== appId) { return; }
                _send(payload);
            }

            function sendMessage(messageId, results) {
                send({id: messageId, result: results});
            }

            function sendError(messageId, message) {
                send({id: messageId, error: message});
            }

            if (event.origin !== application.origin) { return; }

            var data = event.data;
            if (data.ethers !== 'v\x01\n') { return; }

            var params = data.params;
            switch (data.action) {
                /**
                 *   Events
                 */

                case 'ready':
                    // @TODO: don't send ready back until blockNumber, gasPrice, etc. set up
                    divLoadingSpinner.classList.remove('showing');
                    divApp.style.opacity = '1';

                    if (params.title) {
                        setName(params.title);
                    }
                    setReady(true);
                    send({action: 'ready'});
                    send({action: 'block', 'blockNumber': provider.blockNumber});
                    lastBlockNumberSent = provider.blockNumber;
                    break;

                /**
                 *   Account
                 */

                case 'getAccount':
                    if (accounts.activeAccount) {
                        sendMessage(data.id, accounts.activeAccount.address);
                    } else {
                        sendMessage(data.id, null);
                    }
                    break;

                case 'getNetwork':
                    sendMessage(data.id, (testnet ? 'morden': 'homestead'));
                    break;

                case 'fundAccount':
                    if (!testnet) {
                        sendError(data.id, 'invalid network');
                        break;
                    }

                    try {
                        provider.fundAccount(Wallet.getAddress(params.address)).then(function(hash) {
                            sendMessage(data.id, hash);
                        }, function(error) {
                            console.log(error);
                            sendError(data.id, 'unknown error');
                        });
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }
                    break;

                case 'setupEvent':
                    try {
                        (function(eventId, topics) {
                            // Stop any existing filter
                            if (events[eventId]) {
                                provider.unregisterFilter(events[eventId].filterId);
                            }

                            // Start a new filter
                            var filterId = provider.registerFilter(topics, function(data) {
                                send({action: 'event', eventId: eventId, data: data});
                            });

                            // Remember the filterId
                            events[eventId] = {filterId: filterId};
                        })(ensureInteger(params.eventId, 'eventId'), params.topics);  // @TODO: verify topics
                        sendMessage(data.id, true);
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }
                    break;

                case 'teardownEvent':
                    try {
                        (function(eventId) {
                            var filter = events[eventId];
                            if (!filter) { return; }
                            provider.unregisterFilter(filterId);
                            delete events[eventId];
                        })(ensureInteger(params.eventId, 'eventId'));
                        sendMessage(data.id, true);
                    } catch (error) {
                        sendError(data.id, 'unknown error');
                    }
                    break;

                /**
                 *   User Interface
                 */
                 case 'notify':
                     try {
                         Modal.notify('Application \u2014 ' + application.name, ensureString(params.message));
                     } catch (error) {
                         sendError(data.id, 'unknown error');
                     }
                     break;

                /**
                 *   Blockchain transaction calls
                 */

                case 'send':
                    if (!accounts.activeAccount) {
                        sendError(data.id, 'cancelled');
                        break;
                    }

                    try {
                        modalPushSend(
                            accounts.activeAccount,
                            Wallet.getAddress(params.address),
                            ensureHexString(params.amountWei)
                        ).then(function(hash) {
                            sendMessage(data.id, hash);
                            Modal.clear();
                        }, function(error) {
                            if (error.message === 'cancelled' || error.message === 'purged') {
                                sendError(data.id, 'cancelled');
                            } else {
                                sendError(data.id, 'unknown error');
                            }
                            if (error.message !== 'purged') { Modal.clear(); }
                        });
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }

                    break;

                case 'sendTransaction':
                    if (!accounts.activeAccount) {
                        sendError(data.id, 'cancelled');
                        break;
                    }

                    try {
                        modalPushSendTransaction(
                            accounts.activeAccount,
                            checkTransaction(params.transaction)
                        ).then(function(info) {
                            sendMessage(data.id, info.hash);
                            Modal.clear();
                        }, function(error) {
                            if (error.message === 'cancelled' || error.message === 'purged') {
                                sendError(data.id, 'cancelled');
                            } else {
                                sendError(data.id, 'unknown error');
                            }
                            if (error.message !== 'purged') { Modal.clear(); }
                        });
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }

                    break;

                case 'deployContract':
                    if (!accounts.activeAccount) {
                        sendError(data.id, 'cancelled');
                        break;
                    }

                    try {
                        modalPushDeployContract(accounts.activeAccount, {
                            bytecode: ensureHexString(params.bytecode),
                            compilerVersion: params.compilerVersion,
                            deploymentTarget: params.deploymentTarget,
                            optimize: params.optimize,
                            source: params.source
                        }).then(function(info) {
                            sendMessage(data.id, {hash: info.hash, address: info.to});
                            Modal.clear();
                        }, function(error) {
                            if (error.message === 'cancelled' || error.message === 'purged') {
                                sendError(data.id, 'cancelled');
                            } else {
                                console.log(error);
                                sendError(data.id, 'unknown error');
                            }
                            if (error.message !== 'purged') { Modal.clear(); }
                        });
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }

                    break;


                /**
                 *   Blockchain calls (read-only)
                 */

                case 'call':
                    try {
                        (function(transaction) {
                            if (!transaction.from && accounts.activeAccount) {
                                transaction.from = accounts.activeAccount.address;
                            }
                            provider.call(transaction).then(function(result) {
                                sendMessage(data.id, result);
                            }, function(error) {
                                console.log(error);
                                sendError(data.id, 'unknown error');
                            });
                        })(checkTransaction(params.transaction));
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }
                    break;

                case 'estimateGas':
                    try {
                        (function(transaction) {
                            if (!transaction.from && accounts.activeAccount) {
                                transaction.from = accounts.activeAccount.address;
                            }
                            provider.estimateGas(transaction).then(function(result) {
                                sendMessage(data.id, '0x' + result.toString(16));
                            }, function(error) {
                                console.log(error);
                                sendError(data.id, 'unknown error');
                            });
                        })(checkTransaction(params.transaction));
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }
                    break

                case 'getBalance':
                    try {
                        provider.getBalance(params.address, params.blockNumber).then(function(result) {
                            sendMessage(data.id, '0x' + result.toString(16));
                        }, function(error) {
                            console.log(error);
                            sendError(data.id, 'unknown error');
                        });
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }
                    break;

                case 'getBlock':
                    try {
                        // @TODO: difficulty vs. totalDifficulty? Sanitize data
                        var fields = ['extraData', 'gasLimit', 'gasUsed', 'hash', 'number', 'timestamp'];
                        provider.getBlock(params.block).then(function(result) {
                            var block = {}
                            fields.forEach(function(key) { block[key] = result[key]; });
                            sendMessage(data.id, block);
                        }, function(error) {
                            console.log(error);
                            sendError(data.id, 'unknown error');
                        });
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }
                    break;

                case 'getBlockNumber':
                    sendMessage(data.id, provider.blockNumber);
                    break;

                case 'getGasPrice':
                    sendMessage(data.id, provider.gasPrice);
                    break;

                case 'getTransaction':
                    try {
                        provider.getTransaction(params.hash).then(function(transaction) {
                            sendMessage(data.id, transaction);
                        }, function(error) {
                            console.log(error);
                            sendError(data.id, 'unknown error')
                        });
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }
                    break;

                case 'getTransactionCount':
                    try {
                        provider.getTransactionCount(params.address, params.blockNumber).then(function(result) {
                            sendMessage(data.id, result);
                        }, function(error) {
                            console.log(error);
                            sendError(data.id, 'unknown error');
                        });
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }
                    break;

                case 'getTransactionReceipt':
                    try {
                        provider.getTransactionReceipt(params.hash).then(function(transaction) {
                            sendMessage(data.id, transaction);
                        }, function(error) {
                            console.log(error);
                            sendError(data.id, 'unknown error')
                        });
                    } catch (error) {
                        console.log(error);
                        sendError(data.id, 'unknown error');
                    }
                    break;


                default:
                    console.log('Unknown action: ' + data.action);
                    sendError(data.id, 'invalid command')
            }
        }, false);

        // Don't bounce immediately after loading...
        var allowBounce = false;
        setTimeout(function() { allowBounce = true; }, 4000);

        provider.onblock = function(blockNumber) {
            if (allowBounce) { bounceLogo(); }
            if (blockNumber === lastBlockNumberSent || !application.ready) { return; }
            lastBlockNumberSent = blockNumber;
            _send({action: 'block', 'blockNumber': blockNumber});
        }

        accounts.on('activeChange', function(account) {
            if (lastAccountSent === account || !application.ready) { return; }
            lastAccountSent = account;
            _send({action: 'accountChanged', account: (account ? account.address: null)});
        });

        var lastFragment = null;
        function check(fragment) {
            if (fragment === lastFragment) { return; }
            lastFragment = fragment;

            console.log('Checking fragment: ' + fragment);
            if (!fragment) { fragment = '#!/app-link/0x5543707cc4520f3984656e8edea6527ca474e77b.ethers.space/'; }
            application.decodeFragment(fragment).then(function(url) {
                console.log('Loading: ' + url);
                application.load(url);
            }, function(error) {
                console.log('invalid fragment.');
            });
        }

        window.addEventListener('popstate', function(event) {
            check(location.hash);
        });
        check(location.hash);

        return application;
    })();
    _this.application = application;

    document.addEventListener('DOMContentLoaded', function() {
        //application.load("http://localhost:8001/demo/testnet-faucet/");
    });

    (function() {
        function check(fragment, animated) {
            console.log('Fragment:' + fragment);

            var appFragment = fragment;
            if (appFragment.substring(0, 3) !== '#!/') {
                appFragment = '#!/app-link/0x5543707cc4520f3984656e8edea6527ca474e77b.ethers.space/';
            }

            var appFragmentParts = appFragment.split('/');
            /* @TODO: This is where the good stuff goes for the Alias Registry
            if (appFragmentParts.length === 2) {
                if (appFragmentParts[1] === 'welcome') {
                    // Do welcome stuff here
                } else {
                    appFragment = null;
                }

            } else 
            */
            if (appFragmentParts.length >= 3) {
                var url = null;
                if (appFragmentParts[1] === 'app-link') {
                    url = 'https://' + appFragment.substring('#!/app-link/'.length);
                } else if (appFragmentParts[1] === 'app-link-insecure') {
                    // @TODO: Check for if insecure is allowed.
                    url = 'http://' + appFragment.substring('#!/app-link-insecure/'.length);
                } else if (appFragmentParts[1] === 'app') {
                } else {
                    appFragment = null;
                }

                if (url) {
                    application.load(url);
                }
            }

            /*
            var href = 'location.href.split('#')[0] + '#!/' + appLink;

            if (href !== location.href) {
                history[animated ? 'pushState': 'replaceState']({}, document.title, href);
                application.load(appHref);
            }
            */
        }

        // When the fragment changes, update the UI
        /*
        window.addEventListener('popstate', function(event) {
            check(location.hash, true);
        });
        check(location.hash, false);
        */
    })();

    //Modal.push('sending');
    //startSend(activeAccount, '0x02F024e0882B310c6734703AB9066EdD3a10C6e0', Wallet.parseEther('0.001'));

})(this);
