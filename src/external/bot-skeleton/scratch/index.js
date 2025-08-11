import './index.scss';

export {
    load,
    runGroupedEvents,
    runIrreversibleEvents,
    save,
    scrollWorkspace,
    updateWorkspaceName,
} from './utils/index';
// Scratch/Blockly integration
export * from './blocks';
export * from './hooks';
export * from './utils';

// Main scratch initialization
export const initScratch = () => {
    console.log('Initializing Scratch/Blockly integration');
    // Add initialization logic here
};
