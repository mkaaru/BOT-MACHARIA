
import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Input, Text } from '@deriv-com/ui';
import { Modal } from '@/components/shared_ui';
import { useStore } from '@/hooks/useStore';
import type { BlacklistedUser } from '@/stores/user-management-store';
import './user-management-modal.scss';

interface UserManagementModalProps {
    is_open: boolean;
    onClose: () => void;
}

const UserManagementModal: React.FC<UserManagementModalProps> = observer(({ is_open, onClose }) => {
    const { user_management } = useStore();
    const [new_user_id, setNewUserId] = useState('');
    const [new_user_reason, setNewUserReason] = useState('');

    const handleAddUser = () => {
        if (new_user_id.trim()) {
            user_management.addUserToBlacklist({
                loginid: new_user_id.trim(),
                reason: new_user_reason.trim() || 'Manual restriction',
            });
            setNewUserId('');
            setNewUserReason('');
        }
    };

    const handleRemoveUser = (loginid: string) => {
        user_management.removeUserFromBlacklist(loginid);
    };

    return (
        <Modal
            className='user-management-modal'
            is_open={is_open}
            toggleModal={onClose}
            title='User Access Management'
        >
            <div className='user-management-modal__content'>
                <div className='user-management-modal__add-section'>
                    <Text size='sm' weight='bold'>
                        Restrict User Access
                    </Text>
                    <div className='user-management-modal__form'>
                        <Input
                            label='User Login ID'
                            value={new_user_id}
                            onChange={(e) => setNewUserId(e.target.value)}
                            placeholder='e.g., michaelmaina195, CR1234567'
                        />
                        <Input
                            label='Reason (Optional)'
                            value={new_user_reason}
                            onChange={(e) => setNewUserReason(e.target.value)}
                            placeholder='Reason for restriction'
                        />
                        <Button
                            onClick={handleAddUser}
                            disabled={!new_user_id.trim()}
                            color='red'
                        >
                            Restrict User
                        </Button>
                    </div>
                </div>

                <div className='user-management-modal__list-section'>
                    <Text size='sm' weight='bold'>
                        Restricted Users ({user_management.blacklisted_users.length})
                    </Text>
                    {user_management.blacklisted_users.length === 0 ? (
                        <Text size='xs' color='less-prominent'>
                            No users are currently restricted.
                        </Text>
                    ) : (
                        <div className='user-management-modal__user-list'>
                            {user_management.blacklisted_users.map((user) => (
                                <div key={user.loginid} className='user-management-modal__user-item'>
                                    <div className='user-management-modal__user-info'>
                                        <Text size='xs' weight='bold'>
                                            {user.loginid}
                                        </Text>
                                        {user.reason && (
                                            <Text size='xxs' color='less-prominent'>
                                                {user.reason}
                                            </Text>
                                        )}
                                        <Text size='xxs' color='less-prominent'>
                                            Restricted: {new Date(user.blacklistedAt).toLocaleDateString()}
                                        </Text>
                                    </div>
                                    <Button
                                        size='small'
                                        variant='outlined'
                                        onClick={() => handleRemoveUser(user.loginid)}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
});

export default UserManagementModal;
