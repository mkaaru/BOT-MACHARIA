
import { action, computed, makeObservable, observable } from 'mobx';

export interface BlacklistedUser {
    loginid: string;
    email?: string;
    username?: string;
    blacklistedAt: string;
    reason?: string;
}

export default class UserManagementStore {
    blacklisted_users: BlacklistedUser[] = [];
    is_loading = false;

    constructor() {
        makeObservable(this, {
            blacklisted_users: observable,
            is_loading: observable,
            is_user_blacklisted: computed,
            addUserToBlacklist: action,
            removeUserFromBlacklist: action,
            loadBlacklistedUsers: action,
            saveBlacklistedUsers: action,
        });

        this.loadBlacklistedUsers();
    }

    get is_user_blacklisted() {
        return (loginid: string) => {
            return this.blacklisted_users.some(user => user.loginid === loginid);
        };
    }

    addUserToBlacklist = (user: Omit<BlacklistedUser, 'blacklistedAt'>) => {
        const blacklistedUser: BlacklistedUser = {
            ...user,
            blacklistedAt: new Date().toISOString(),
        };
        
        // Check if user is already blacklisted
        if (!this.is_user_blacklisted(user.loginid)) {
            this.blacklisted_users.push(blacklistedUser);
            this.saveBlacklistedUsers();
        }
    };

    removeUserFromBlacklist = (loginid: string) => {
        this.blacklisted_users = this.blacklisted_users.filter(user => user.loginid !== loginid);
        this.saveBlacklistedUsers();
    };

    loadBlacklistedUsers = () => {
        try {
            const stored = localStorage.getItem('tradecortex_blacklisted_users');
            if (stored) {
                this.blacklisted_users = JSON.parse(stored);
            }
        } catch (error) {
            console.error('Error loading blacklisted users:', error);
        }
    };

    saveBlacklistedUsers = () => {
        try {
            localStorage.setItem('tradecortex_blacklisted_users', JSON.stringify(this.blacklisted_users));
        } catch (error) {
            console.error('Error saving blacklisted users:', error);
        }
    };

    // Method to check and block user during authentication
    checkUserAccess = (loginid: string) => {
        if (this.is_user_blacklisted(loginid)) {
            throw new Error('Access denied: Your account has been restricted from using this application.');
        }
        return true;
    };
}
