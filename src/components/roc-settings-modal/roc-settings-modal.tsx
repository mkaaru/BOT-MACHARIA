import React from 'react';
import Modal from '../shared_ui/modal';
import Text from '../shared_ui/text';
import Button from '../shared_ui/button';
import ToggleSwitch from '../shared_ui/toggle-switch';
import './roc-settings-modal.scss';

const RocSettingsModal = ({ isOpen, onClose }) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="ROC Settings">
      <div className="roc-settings-content">
        <div className="setting-item">
          <Text>Enable ROC Feature</Text>
          <ToggleSwitch />
        </div>
        <div className="setting-item">
          <Text>ROC Threshold</Text>
          {/* Placeholder for input or slider */}
          <input type="number" defaultValue="10" />
        </div>
        <div className="setting-item">
          <Text>ROC Interval</Text>
          {/* Placeholder for input or dropdown */}
          <input type="text" defaultValue="5s" />
        </div>
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={() => alert('Settings saved!')}>Save</Button>
      </div>
    </Modal>
  );
};

export default RocSettingsModal;