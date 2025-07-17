import { save_types } from '../constants';
import { config } from '../constants/config';
import { api_base } from '../services/api/api-base';
import ApiHelpers from '../services/api/api-helpers';
import Interpreter from '../services/tradeEngine/utils/interpreter';
import { compareXml, observer as globalObserver } from '../utils';
import { getSavedWorkspaces, saveWorkspaceToRecent } from '../utils/local-storage';
import { isDbotRTL } from '../utils/workspace';
import main_xml from './xml/main.xml';
import { forgetAccumulatorsProposalRequest } from './accumulators-proposal-handler';
import { loadBlockly } from './blockly';
import DBotStore from './dbot-store';
import { isAllRequiredBlocksEnabled, updateDisabledBlocks, validateErrorOnBlockDelete } from './utils';

class DBot {
    constructor() {
        this.interpreter = null;
        this.workspace = null;
        this.before_run_funcs = [];
        this.symbol = null;
        this.is_bot_running = false;
    }

    /**
     * Initialises the workspace and mounts it to a container element (app_contents).
     */
    async initWorkspace(public_path, store, api_helpers_store, is_mobile, is_dark_mode) {
        await loadBlockly(is_dark_mode);
        const recent_files = await getSavedWorkspaces();
        this.interpreter = Interpreter();

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        var that = this;
        window.Blockly.Blocks.trade_definition_tradetype.onchange = function (event) {
            if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
                return;
            }

            this.enforceLimitations();

            const { name, type } = event;

            if (type === window.Blockly.Events.BLOCK_CHANGE) {
                const is_symbol_list_change = name === 'SYMBOL_LIST';
                const is_trade_type_cat_list_change = name === 'TRADETYPECAT_LIST';

                if (is_symbol_list_change || is_trade_type_cat_list_change) {
                    const { contracts_for } = ApiHelpers?.instance ?? {};
                    const top_parent_block = this.getTopParent();
                    const market_block = top_parent_block.getChildByType('trade_definition_market');
                    const market = market_block.getFieldValue('MARKET_LIST');
                    const submarket = market_block.getFieldValue('SUBMARKET_LIST');
                    const symbol = market_block.getFieldValue('SYMBOL_LIST');
                    const category = this.getFieldValue('TRADETYPECAT_LIST');
                    const trade_type = this.getFieldValue('TRADETYPE_LIST');
                    const is_trade_type_accumulator = trade_type === 'accumulator';
                    if (!is_trade_type_accumulator) forgetAccumulatorsProposalRequest(that);

                    if (is_symbol_list_change) {
                        contracts_for?.getTradeTypeCategories?.(market, submarket, symbol).then(categories => {
                            const category_field = this.getField('TRADETYPECAT_LIST');
                            if (category_field) {
                                category_field.updateOptions(categories, {
                                    default_value: category,
                                    should_pretend_empty: true,
                                    event_group: event.group,
                                });
                            }
                        });
                        that.symbol = symbol;
                        if (
                            !that.is_bot_running &&
                            that.interpreter &&
                            !this.workspace.options.readOnly &&
                            symbol !== that.interpreter.bot.tradeEngine.symbol
                        ) {
                            const run_button = document.querySelector('#db-animation__run-button');
                            if (run_button) run_button.disabled = true;

                            that.interpreter.unsubscribeFromTicksService().then(async () => {
                                await that.interpreter?.bot.tradeEngine.watchTicks(symbol);
                            });
                        }
                    } else if (is_trade_type_cat_list_change && event.blockId === this.id) {
                        contracts_for?.getTradeTypes?.(market, submarket, symbol, category).then(trade_types => {
                            const trade_type_field = this.getField('TRADETYPE_LIST');
                            trade_type_field.updateOptions(trade_types, {
                                default_value: trade_type,
                                should_pretend_empty: true,
                                event_group: event.group,
                            });
                        });
                    }
                }
            }
        };

        return new Promise((resolve, reject) => {
            __webpack_public_path__ = public_path; // eslint-disable-line no-global-assign
            ApiHelpers.setInstance(api_helpers_store);
            DBotStore.setInstance(store);
            const window_width = window.innerWidth;
            try {
                let workspaceScale = 0.7;

                const { handleFileChange } = DBotStore.instance;
                if (window_width < 1640) {
                    if (is_mobile) {
                        workspaceScale = 0.6;
                    } else {
                        const scratch_div_width = document.getElementById('scratch_div')?.offsetWidth;
                        const zoom_scale = scratch_div_width / window_width / 1.5;
                        workspaceScale = zoom_scale;
                    }
                }
                const el_scratch_div = document.getElementById('scratch_div');
                if (!el_scratch_div) {
                    return;
                }

                this.workspace = window.Blockly.inject(el_scratch_div, {
                    media: 'assets/media/',
                    renderer: 'zelos',
                    trashcan: !is_mobile,
                    zoom: { wheel: true, startScale: workspaceScale },
                    scrollbars: true,
                    theme: window.Blockly.Themes.zelos_renderer,
                });

                this.workspace.RTL = isDbotRTL();

                this.workspace.cached_xml = { main: main_xml };

                this.workspace.addChangeListener(this.valueInputLimitationsListener.bind(this));
                this.workspace.addChangeListener(event => updateDisabledBlocks(this.workspace, event));
                this.workspace.addChangeListener(event => this.workspace.dispatchBlockEventEffects(event));
                this.workspace.addChangeListener(event => {
                    if (event.type === 'drag' && !event.isStart && !is_mobile) validateErrorOnBlockDelete();
                    if (event.type == window.Blockly.Events.BLOCK_CHANGE) {
                        const block = this.workspace.getBlockById(event.blockId);
                        if (is_mobile && block && event.element == 'collapsed') {
                            block.contextMenu = false;
                        }
                    }
                });

                window.Blockly.derivWorkspace = this.workspace;

                const varDB = new window.Blockly.Names('window');
                varDB.variableMap = window.Blockly.derivWorkspace.getVariableMap();

                window.Blockly.JavaScript.variableDB_ = varDB;

                this.addBeforeRunFunction(this.unselectBlocks.bind(this));
                this.addBeforeRunFunction(this.disableStrayBlocks.bind(this));
                this.addBeforeRunFunction(this.checkForErroredBlocks.bind(this));
                this.addBeforeRunFunction(this.checkForRequiredBlocks.bind(this));

                // Push main.xml to workspace and reset the undo stack.
                this.workspace.current_strategy_id = window.Blockly.utils.idGenerator.genUid();

                window.Blockly.derivWorkspace.strategy_to_load = main_xml;
                window.Blockly.getMainWorkspace().strategy_to_load = main_xml;
                window.Blockly.getMainWorkspace().RTL = isDbotRTL();

                let file_name = config().default_file_name;
                if (recent_files && recent_files.length) {
                    const latest_file = recent_files[0];
                    window.Blockly.derivWorkspace.strategy_to_load = latest_file.xml;
                    window.Blockly.getMainWorkspace().strategy_to_load = latest_file.xml;
                    file_name = latest_file.name;
                    window.Blockly.derivWorkspace.current_strategy_id = latest_file.id;
                    window.Blockly.getMainWorkspace().current_strategy_id = latest_file.id;
                }

                const event_group = `dbot-load${Date.now()}`;
                window.Blockly.Events.setGroup(event_group);
                window.Blockly.Xml.domToWorkspace(
                    window.Blockly.utils.xml.textToDom(window.Blockly.derivWorkspace.strategy_to_load),
                    this.workspace
                );
                const { save_modal } = DBotStore.instance;

                save_modal.updateBotName(file_name);
                this.workspace.cleanUp(0, is_mobile ? 60 : 56);
                this.workspace.clearUndo();

                window.dispatchEvent(new Event('resize'));
                window.addEventListener('dragover', DBot.handleDragOver);
                window.addEventListener('drop', e => DBot.handleDropOver(e, handleFileChange));
                // disable overflow
                el_scratch_div.parentNode.style.overflow = 'hidden';
                resolve();
            } catch (error) {
                // TODO: Handle error.
                reject(error);
                throw error;
            }
        });
    }

    /** Compare stored strategy xml with currently running xml */
    isStrategyUpdated(current_xml_dom, recent_files) {
        if (recent_files && recent_files.length) {
            const stored_strategy = recent_files.filter(
                strategy => strategy?.id === this.workspace?.current_strategy_id
            )?.[0];
            if (stored_strategy?.xml) {
                const stored_strategy_xml = stored_strategy?.xml;
                const current_xml = window.Blockly.Xml.domToText(current_xml_dom);
                const is_same_strategy = compareXml(stored_strategy_xml, current_xml);
                if (is_same_strategy) {
                    return false;
                }
            }
        }
        return true;
    }

    /** Saves the current workspace to local storage
     * and update saved status if strategy changes  */
    async saveRecentWorkspace() {
        const current_xml_dom = this?.workspace ? Blockly?.Xml?.workspaceToDom(this.workspace) : null;
        try {
            const recent_files = await getSavedWorkspaces();
            if (current_xml_dom && this.isStrategyUpdated(current_xml_dom, recent_files)) {
                await saveWorkspaceToRecent(current_xml_dom, save_types.UNSAVED);
            }
        } catch (error) {
            globalObserver.emit('Error', error);
            await saveWorkspaceToRecent(current_xml_dom, save_types.UNSAVED);
        }
    }

    /**
     * Allows you to add a function that needs to be executed before running the bot. Each
     * function needs to return true in order for the bot to run.
     * @param {Function} func Function to execute which returns true/false.
     */
    addBeforeRunFunction(func) {
        this.before_run_funcs.push(func);
    }

    shouldRunBot() {
        return this.before_run_funcs.every(func => !!func());
    }

    async initializeInterpreter() {
        if (this.interpreter) {
            await this.interpreter.terminateSession();
        }
        this.interpreter = Interpreter();
    }
    /**
     * Runs the bot. Does a sanity check before attempting to generate the
     * JavaScript code that's fed to the interpreter.
     */
    runBot() {
        if (api_base.is_stopping) return;

        try {
            api_base.is_stopping = false;

            console.log('🚀 Starting bot run...');

            // Ensure interpreter and bot are properly initialized
            if (!this.interpreter || !this.interpreter.bot) {
                console.log('🔧 Creating new interpreter...');
                this.interpreter = Interpreter();
            }

            // Check if bot is properly initialized before running
            if (!this.interpreter.bot || !this.interpreter.bot.tradeEngine.options) {
                console.log('⚙️ Initializing trade engine...');
                // Initialize bot with default token and symbol if not already done
                if (api_base.token && this.symbol) {
                    this.interpreter.bot.tradeEngine.init(api_base.token, {
                        symbol: this.symbol || 'R_100',
                        candleInterval: 60,
                        contractTypes: ['CALL', 'PUT']
                    });
                    console.log(`✅ Trade engine initialized with symbol: ${this.symbol}`);
                } else {
                    console.error('❌ Bot initialization failed: Missing token or symbol');
                    globalObserver.emit('Error', { message: 'Bot initialization failed: Missing token or symbol' });
                    return;
                }
            }

            const code = this.generateCode();

            if (!code) {
                console.error('❌ Failed to generate code from blocks');
                globalObserver.emit('Error', { message: 'Failed to generate code from blocks' });
                return;
            }

            if (!this.interpreter.bot.tradeEngine.checkTicksPromiseExists()) {
                console.log('🔄 Recreating interpreter for tick service...');
                this.interpreter = Interpreter();
                // Re-initialize after creating new interpreter
                if (api_base.token && this.symbol) {
                    this.interpreter.bot.tradeEngine.init(api_base.token, {
                        symbol: this.symbol || 'R_100',
                        candleInterval: 60,
                        contractTypes: ['CALL', 'PUT']
                    });
                }
            }

            this.is_bot_running = true;
            api_base.setIsRunning(true);

            console.log('▶️ Executing bot code...');

            const runPromise = this.interpreter.run(code);
            if (runPromise && typeof runPromise.then === 'function') {
                runPromise.catch(error => {
                    console.error('❌ Bot execution error:', error);
                    globalObserver.emit('Error', error);
                    this.stopBot();
                });
            }

            // Wait for bot to be fully initialized before starting trades
            this.initializationTimeout = setTimeout(() => {
                if (this.is_bot_running && this.interpreter?.bot?.tradeEngine) {
                    console.log('🎯 Bot initialization complete, starting trade execution...');
                    this.startTradingLoop();
                }
            }, 3000);

        } catch (error) {
            console.error('❌ Bot run error:', error);
            globalObserver.emit('Error', error);

            if (this.interpreter) {
                this.stopBot();
            }
        }
    }

    startTradingLoop() {
        try {
            // Execute first trade immediately
            this.executeTrade();

            // Set up continuous trading
            this.tradingInterval = setInterval(() => {
                if (this.is_bot_running && this.interpreter?.bot?.tradeEngine) {
                    this.executeTrade();
                }
            }, 10000); // Execute trade every 10 seconds

            // Set up status monitoring
            this.statusCheckInterval = setInterval(() => {
                if (this.is_bot_running && this.interpreter?.bot?.tradeEngine) {
                    this.checkBotStatus();
                }
            }, 5000); // Check status every 5 seconds

        } catch (error) {
            console.error('❌ Trading loop error:', error);
            globalObserver.emit('Error', error);
        }
    }

    executeTrade() {
        try {
            if (!this.interpreter?.bot?.tradeEngine) {
                console.error('❌ Trade engine not available');
                return;
            }

            // Check if there's already an active trade
            const hasActiveTrade = this.interpreter.bot.tradeEngine.data.contract?.contract_id && 
                                 !this.interpreter.bot.tradeEngine.data.contract?.is_sold;

            if (hasActiveTrade) {
                console.log('⏳ Trade already in progress, skipping...');
                return;
            }

            // Alternate between CALL and PUT
            const contractType = Math.random() > 0.5 ? 'CALL' : 'PUT';

            console.log(`🚀 Executing ${contractType} trade...`);

            // Start trade with proper parameters
            this.interpreter.bot.tradeEngine.start({
                amount: 1,
                contract_type: contractType,
                duration: 1,
                duration_unit: 't',
                symbol: this.symbol || 'R_100',
                basis: 'stake'
            });

            this.lastTradeTime = Date.now();

        } catch (error) {
            console.error('❌ Trade execution error:', error);
        }
    }

    checkBotStatus() {
        try {
            const state = this.interpreter.bot.tradeEngine.store.getState();
            const timeSinceLastTrade = Date.now() - (this.lastTradeTime || 0);

            console.log(`🔍 Bot Status: scope=${state.scope}, proposalsReady=${state.proposalsReady}, timeSinceLastTrade=${timeSinceLastTrade}ms`);

            // If bot is stuck for more than 30 seconds, force restart
            if (timeSinceLastTrade > 30000) {
                console.log('⚠️ Bot appears stuck, forcing restart...');
                this.interpreter.bot.tradeEngine.forceNextTrade();
                this.lastTradeTime = Date.now();
            }

        } catch (error) {
            console.error('❌ Status check error:', error);
        }
    }

    /**
     * Generates the code that is passed to the interpreter.
     * @param {Object} limitations Optional limitations (legacy argument)
     */
    generateCode(limitations = {}) {
        if (!this.shouldRunBot()) {
            return null;
        }

        const is_sync_blocks_enabled = window.Blockly.getMainWorkspace().getBlocksByType('trade_definition_tradeoptions').length > 0;

        window.Blockly.JavaScript.STATEMENT_PREFIX = 'return Bot.highlightBlock(%1);\n';
        if (window.Blockly.JavaScript.addReservedWords) {
            window.Blockly.JavaScript.addReservedWords('code,timeouts,setBlockStatus,Bot');
        } else if (window.Blockly.JavaScript.javascriptGenerator && window.Blockly.JavaScript.javascriptGenerator.addReservedWords) {
            window.Blockly.JavaScript.javascriptGenerator.addReservedWords('code,timeouts,setBlockStatus,Bot');
        }

        let generatedCode = '';
        if (window.Blockly.JavaScript.workspaceToCode) {
            generatedCode = window.Blockly.JavaScript.workspaceToCode(this.workspace);
        } else if (window.Blockly.JavaScript.javascriptGenerator) {
            generatedCode = window.Blockly.JavaScript.javascriptGenerator.workspaceToCode(this.workspace);
        } else {
            throw new Error('Unable to find Blockly JavaScript generator');
        }

        const code = `
            var highlightPerStackTrace = false;
            var code = function() {
                ${generatedCode}
            };
        `;

        if (is_sync_blocks_enabled) {
            return `${code}\nBot.start(code);`;
        }

        return code;
    }

    /**
     * Instructs the interpreter to stop the bot. If there is an active trade
     * that trade will be completed first to reflect correct contract status in UI.
     */
    async stopBot() {
        if (api_base.is_stopping) return;

        console.log('🛑 Stopping bot...');
        api_base.setIsRunning(false);

        // Clear all intervals and timeouts
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }

        if (this.tradingInterval) {
            clearInterval(this.tradingInterval);
            this.tradingInterval = null;
        }

        if (this.initializationTimeout) {
            clearTimeout(this.initializationTimeout);
            this.initializationTimeout = null;
        }

        // Check if there's an active contract that needs to be completed
        const hasActiveContract = this.interpreter?.bot?.tradeEngine?.data?.contract?.contract_id && 
                                 !this.interpreter?.bot?.tradeEngine?.data?.contract?.is_sold;

        if (hasActiveContract) {
            console.log('⏳ Waiting for active contract to complete...');
            globalObserver.emit('ui.log.info', 'Waiting for active contract to complete...');

            // Set up a timeout to force stop if contract doesn't complete
            const forceStopTimeout = setTimeout(() => {
                console.log('⚠️ Forcing bot stop due to timeout');
                globalObserver.emit('ui.log.warn', 'Contract taking too long to complete, forcing bot stop');
                this.forceStopBot();
            }, 20000); // 20 second timeout

            try {
                await this.interpreter.stop();
                clearTimeout(forceStopTimeout);
            } catch (error) {
                clearTimeout(forceStopTimeout);
                globalObserver.emit('Error', error);
            }
        } else {
            await this.interpreter.stop();
        }

        this.is_bot_running = false;
        this.interpreter = null;
        this.interpreter = Interpreter();
        await this.interpreter.bot.tradeEngine.watchTicks(this.symbol);
        forgetAccumulatorsProposalRequest(this);

        console.log('✅ Bot stopped successfully');
    }

    /**
     * Force stops the bot without waiting for contract completion
     */
    async forceStopBot() {
        try {
            api_base.setIsRunning(false);

            if (this.interpreter) {
                await this.interpreter.terminateSession();
            }

            this.is_bot_running = false;
            this.interpreter = null;
            this.interpreter = Interpreter();
            await this.interpreter.bot.tradeEngine.watchTicks(this.symbol);
            forgetAccumulatorsProposalRequest(this);

            globalObserver.emit('ui.log.info', 'Bot stopped successfully');
        } catch (error) {
            globalObserver.emit('Error', error);
        }
    }

    /**
     * Immediately instructs the interpreter to terminate the WS connection and bot.
     */
    async terminateBot() {
        if (this.interpreter) {
            await this.interpreter.terminateSession();
            this.interpreter = null;
            this.interpreter = Interpreter();
            await this.interpreter.bot.tradeEngine.watchTicks(this.symbol);
        }
    }

    terminateConnection = () => {
        api_base.terminate();
    };

    /**
     * Unselects any selected block before running the bot.
     */
    // eslint-disable-next-line class-methods-use-this
    unselectBlocks() {
        if (window.Blockly.getSelected()) {
            window.Blockly.getSelected().unselect();
        }
        return true;
    }

    /**
     * Disable blocks outside of any main or independent blocks.
     */
    disableStrayBlocks() {
        const top_blocks = this.workspace.getTopBlocks();
        top_blocks.forEach(block => {
            if (!block.isMainBlock() && !block.isIndependentBlock()) {
                this.disableBlocksRecursively(block);
            }
        });
        return true;
    }

    /**
     * Disable blocks and their optional children.
     */
    disableBlocksRecursively(block) {
        block.setDisabled(true);
        if (block.nextConnection?.targetConnection) {
            this.disableBlocksRecursively(block.nextConnection.targetConnection.sourceBlock_);
        }
    }

    /**
     * Check if there are any blocks highlighted for errors.
     */
    checkForErroredBlocks() {
        // Force a check on value inputs.
        this.valueInputLimitationsListener({}, true);

        const all_blocks = this.workspace.getAllBlocks(true);
        const error_blocks = all_blocks
            .filter(block => block.is_error_highlighted && !block.disabled)
            // filter out duplicated error message
            .filter((block, index, self) => index === self.findIndex(b => b.error_message === block.error_message));

        if (!error_blocks.length) {
            return true;
        }

        this.workspace.centerOnBlock(error_blocks[0].id);
        error_blocks.forEach(block => {
            globalObserver.emit('ui.log.error', block.error_message);
        });

        return false;
    }

    centerAndHighlightBlock(block_id, should_animate = false) {
        const block_to_highlight = this.workspace.getBlockById(block_id);

        if (!block_to_highlight) {
            return;
        }

        const all_blocks = this.workspace.getAllBlocks();

        all_blocks.forEach(block => block.setErrorHighlighted(false));
        if (should_animate) {
            block_to_highlight.blink();
        }
        block_to_highlight.setErrorHighlighted(true);

        this.workspace.centerOnBlock(block_to_highlight.id);
    }

    unHighlightAllBlocks() {
        this.workspace?.getAllBlocks().forEach(block => block.setErrorHighlighted(false));
    }

    /**
     * Checks whether the workspace contains all required blocks before running the strategy.
     */
    checkForRequiredBlocks() {
        return isAllRequiredBlocksEnabled(this.workspace);
    }

    /**
     * Checks all blocks in the workspace to see if they need to be highlighted
     * in case one of their inputs is not populated, returns an empty value, or doesn't
     * pass the custom validator.
     * Note: The value passed to the custom validator is always a string value
     * @param {window.Blockly.Event} event Workspace event
     */
    valueInputLimitationsListener(event, force_check = false) {
        if (!force_check && (!this.workspace || this.workspace.isDragging())) {
            return;
        }

        window.Blockly.JavaScript.javascriptGenerator.init(this.workspace);

        if (force_check) {
            window.Blockly.hideChaff(false);
        }

        const isGlobalEndDragEvent = () => event.type === window.Blockly.Events.BLOCK_DRAG && !event.isStart;
        const isGlobalDeleteEvent = () => event.type === window.Blockly.Events.BLOCK_DELETE;
        const isGlobalCreateEvent = () => event.type === window.Blockly.Events.BLOCK_CREATE;
        const isClickEvent = () =>
            event.type === window.Blockly.Events.UI && (event.element === 'click' || event.element === 'selected');
        const isChangeEvent = b => event.type === window.Blockly.Events.BLOCK_CHANGE && event.blockId === b.id;
        const isChangeInMyInputs = b => {
            if (event.type === window.Blockly.Events.BLOCK_CHANGE) {
                return b.inputList.some(input => {
                    if (input.connection) {
                        const target_block = input.connection.targetBlock();
                        return target_block && event.blockId === target_block.id;
                    }
                    return false;
                });
            }
            return false;
        };
        const isParentEnabledEvent = b => {
            if (event.type === window.Blockly.Events.BLOCK_CHANGE && event.element === 'disabled') {
                let parent_block = b.getParent();

                while (parent_block !== null) {
                    if (parent_block.id === event.blockId) {
                        return true;
                    }

                    parent_block = parent_block.getParent();
                }
            }
            return false;
        };

        this.workspace.getAllBlocks(true).forEach(block => {
            if (
                force_check ||
                isGlobalEndDragEvent() ||
                isGlobalDeleteEvent() ||
                isGlobalCreateEvent() ||
                isClickEvent() ||
                isChangeEvent(block) ||
                isChangeInMyInputs(block) ||
                isParentEnabledEvent(block)
            ) {
                // Unhighlight disabled blocks and their optional children.
                if (block.disabled) {
                    const unhighlightRecursively = child_blocks => {
                        child_blocks.forEach(child_block => {
                            child_block.setErrorHighlighted(false);
                            unhighlightRecursively(child_block.getChildren());
                        });
                    };

                    unhighlightRecursively([block]);
                    return;
                }

                // No required inputs, ignore this block.
                if (!block.getRequiredValueInputs) {
                    return;
                }

                const required_inputs_object = block.getRequiredValueInputs();
                const required_input_names = Object.keys(required_inputs_object);
                const should_highlight = required_input_names.some(input_name => {
                    const is_selected = window.Blockly.getSelected() === block; // Don't highlight selected blocks.
                    const is_disabled = block.disabled || block.getInheritedDisabled(); // Don't highlight disabled blocks.

                    if (is_selected || is_disabled) {
                        return false;
                    }

                    // Don't unhighlight collapsed blocks with highlighted descendants.
                    if (block.isCollapsed() && block.hasErrorHighlightedDescendant()) {
                        return true;
                    }

                    const input = block.getInput(input_name);

                    if (!input && !block.domToMutation) {
                        // eslint-disable-next-line no-console
                        console.warn('Detected a non-existent required input.', {
                            input_name,
                            type: block.type,
                        });
                    } else if (input.connection) {
                        const order = window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC;
                        const value = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
                            block,
                            input_name,
                            order
                        );
                        const inputValidatorFn = required_inputs_object[input_name];

                        // If a custom validator was supplied, use this to determine whether
                        // the block should be highlighted.
                        if (typeof inputValidatorFn === 'function') {
                            return !!inputValidatorFn(value);
                        }

                        // If there's no custom validator, only check if input was populated and
                        // doesn't return an empty value.
                        return !value;
                    }

                    return true;
                });

                if (should_highlight) {
                    // Remove select highlight in favour of error highlight.
                    block.removeSelect();
                }

                block.setErrorHighlighted(should_highlight, block.error_message || undefined);

                // Automatically expand blocks that have been highlighted.
                if (force_check && (block.is_error_highlighted || block.hasErrorHighlightedDescendant())) {
                    let current_collapsed_block = block;
                    while (current_collapsed_block) {
                        current_collapsed_block.setCollapsed(false);
                        current_collapsed_block = current_collapsed_block.getParent();
                    }
                }
            }
        });
    }

    /**
     * Checks whether the workspace contains non-silent notification blocks. Returns array of names for audio files to be played.
     */
    getStrategySounds() {
        const all_blocks = this.workspace.getAllBlocks();
        const notify_blocks = all_blocks.filter(block => block.type === 'notify');
        const strategy_sounds = [];

        notify_blocks.forEach(block => {
            const selected_sound = block.inputList[0].fieldRow[3].value_;

            if (selected_sound !== 'silent') {
                strategy_sounds.push(selected_sound);
            }
        });

        return strategy_sounds;
    }

    static handleDragOver(event) {
        event.stopPropagation();
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy'; // eslint-disable-line no-param-reassign
    }

    static handleDropOver(event, handleFileChange) {
        const main_workspace_dom = document.getElementById('scratch_div');
        const local_drag_zone = document.getElementById('load-strategy__local-dropzone-area');

        if (main_workspace_dom.contains(event.target)) {
            handleFileChange(event);
        } else if (local_drag_zone && local_drag_zone.contains(event.target)) {
            handleFileChange(event, false);
        } else {
            event.stopPropagation();
            event.preventDefault();
            event.dataTransfer.effectAllowed = 'none';
            event.dataTransfer.dropEffect = 'none';
        }
    }

    generateQuickStrategySignal() {
        try {
            const shouldTrade = this.interpreter.bot.tradeEngine.trade.shouldExecuteTrade();
            if (shouldTrade && !this.interpreter.bot.tradeEngine.trade.purchase.isTradeInProgress()) {
                console.log('Quick Strategy signal generated - executing trade');
                this.executeQuickStrategyTrade();
            }
        } catch (error) {
            console.error('Error generating Quick Strategy signal:', error);
        }
    }

    executeQuickStrategyTrade() {
        try {
            const config = this.interpreter.bot.tradeEngine.trade.quickStrategyConfig;
            if (!config) return;

            // Execute trade with Quick Strategy parameters
            const tradeParams = {
                contract_type: config.contractType || 'even',
                symbol: config.symbol || 'R_10',
                amount: config.amount || 1,
                duration: config.duration || 1,
                duration_unit: config.durationType || 't'
            };

            console.log('Executing Quick Strategy trade with params:', tradeParams);
            this.interpreter.bot.tradeEngine.trade.purchase.purchaseContract(tradeParams);
        } catch (error) {
            console.error('Error executing Quick Strategy trade:', error);
        }
    }
}

export default new DBot.