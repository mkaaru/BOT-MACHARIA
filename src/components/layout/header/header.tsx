import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import { standalone_routes } from '@/components/shared';
import Button from '@/components/shared_ui/button';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { StandaloneCircleUserRegularIcon } from '@deriv/quill-icons/Standalone';
import { requestOidcAuthentication } from '@deriv-com/auth-client';
import { Localize, useTranslations } from '@deriv-com/translations';
import { Header, useDevice, Wrapper } from '@deriv-com/ui';
import { Tooltip } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import AccountsInfoLoader from './account-info-loader';
import AccountSwitcher from './account-switcher';
import MenuItems from './menu-items';
import MobileMenu from './mobile-menu';
import PlatformSwitcher from './platform-switcher';
import './header.scss';
import React, { useState } from 'react';
import Modal from '@/components/shared_ui/modal'; // Import the modal component
import ConnectionStatus from '@/components/connection-status';

const InfoIcon = () => {
    const [showModal, setShowModal] = useState(false);

    const socialLinks = [
        {
            name: 'Telegram',
            url: 'https://t.me/protraders254',
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 0C5.37 0 0 5.37 0 12C0 18.63 5.37 24 12 24C18.63 24 24 18.63 24 12C24 5.37 18.63 0 12 0ZM17.94 8.19L15.98 17.03C15.82 17.67 15.42 17.83 14.88 17.52L11.88 15.33L10.44 16.71C10.27 16.88 10.12 17.03 9.79 17.03L10.02 13.97L15.61 8.9C15.87 8.67 15.56 8.54 15.22 8.77L8.21 13.31L5.24 12.38C4.62 12.19 4.61 11.74 5.38 11.43L17.08 7.08C17.6 6.9 18.06 7.23 17.94 8.19Z" fill="#229ED9"/>
                </svg>
            )
        },
        {
            name: 'WhatsApp',
            url: 'https://chat.whatsapp.com/DoaEcjPhMoy0j6h4euMpsA',
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.893 3.488" fill="#25D366"/>
                </svg>
            )
        }
    ];

    return (
        <>
            <button
                className="info-icon"
                onClick={() => setShowModal(true)}
            >
                <svg width="32" height="32" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Main circle background */}
                    <circle cx="32" cy="32" r="30" fill="url(#socialGradient)"/>

                    {/* Decorative rings */}
                    <circle cx="32" cy="32" r="24" stroke="#FFF" strokeWidth="2" strokeDasharray="4 4"/>
                    <circle cx="32" cy="32" r="18" fill="rgba(255,255,255,0.1)"/>

                    {/* Connect dots pattern */}
                    <circle cx="32" cy="20" r="3" fill="#FFD700"/>
                    <circle cx="44" cy="32" r="3" fill="#4CAF50"/>
                    <circle cx="32" cy="44" r="3" fill="#FF5722"/>
                    <circle cx="20" cy="32" r="3" fill="#2196F3"/>

                    {/* Connection lines */}
                    <path d="M32 23L44 32" stroke="rgba(255,255,255,0.6)" strokeWidth="1"/>
                    <path d="M44 32L32 44" stroke="rgba(255,255,255,0.6)" strokeWidth="1"/>
                    <path d="M32 44L20 32" stroke="rgba(255,255,255,0.6)" strokeWidth="1"/>
                    <path d="M20 32L32 20" stroke="rgba(255,255,255,0.6)" strokeWidth="1"/>

                    {/* Center hub */}
                    <circle cx="32" cy="32" r="6" fill="white"/>
                    <circle cx="32" cy="32" r="4" fill="#E91E63"/>

                    {/* Gradient definition */}
                    <defs>
                        <linearGradient id="socialGradient" x1="0" y1="0" x2="64" y2="64">
                            <stop offset="0%" stopColor="#6b48ff"/>
                            <stop offset="50%" stopColor="#5c27fe"/>
                            <stop offset="100%" stopColor="#3311bb"/>
                        </linearGradient>
                    </defs>
                </svg>
            </button>

            <Modal
                is_open={showModal}
                toggleModal={() => setShowModal(false)}
                title="Connect With Us"
            >
                <div className="social-links-modal">
                    {socialLinks.map((link, index) => (
                        <a
                            key={index}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="social-link"
                        >
                            <span className="social-link__icon">{link.icon}</span>
                            <span className="social-link__name">{link.name}</span>
                        </a>
                    ))}
                </div>
            </Modal>
        </>
    );
};

const AppHeader = observer(() => {
    const { isDesktop } = useDevice();
    const { isAuthorizing, activeLoginid } = useApiBase();
    const { client } = useStore() ?? {};

    const { data: activeAccount } = useActiveAccount({ allBalanceData: client?.all_accounts_balance });
    const { accounts } = client ?? {};
    const has_wallet = Object.keys(accounts ?? {}).some(id => accounts?.[id].account_category === 'wallet');

    const { localize } = useTranslations();

    const { isOAuth2Enabled } = useOauth2();

    const [isToggled, setIsToggled] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [stake, setStake] = useState('');
    const [martingale, setMartingale] = useState('');

    const handleToggle = () => {
        if (!isToggled) {
            setIsModalOpen(true); // Open modal when toggled on
        } else {
            setIsToggled(false); // Turn off toggle
        }
    };

    const handleProceed = () => {
        if (stake.trim() && martingale.trim()) {
            setIsToggled(true); // Enable toggle only if inputs are valid
            setIsModalOpen(false); // Close modal
        } else {
            alert('Please enter valid Stake and Martingale values.');
        }
    };

    const renderAccountSection = () => {
        if (isAuthorizing) {
            return <AccountsInfoLoader isLoggedIn isMobile={!isDesktop} speed={3} />;
        } else if (activeLoginid) {
            return (
                <>
                    {isDesktop && (
                        <Tooltip
                            as='a'
                            href={standalone_routes.personal_details}
                            tooltipContent={localize('Manage account settings')}
                            tooltipPosition='bottom'
                            className='app-header__account-settings'
                        >
                            <StandaloneCircleUserRegularIcon className='app-header__profile_icon' />
                        </Tooltip>
                    )}
                    <AccountSwitcher activeAccount={activeAccount} />
                    {isDesktop &&
                        (has_wallet ? (
                            <Button
                                className='manage-funds-button'
                                has_effect
                                text={localize('Manage funds')}
                                onClick={() => window.location.assign(standalone_routes.wallets_transfer)}
                                primary
                            />
                        ) : (
                            <Button
                                primary
                                onClick={() => {
                                    window.location.assign(standalone_routes.cashier_deposit);
                                }}
                                className='deposit-button'
                            >
                                {localize('Deposit')}
                            </Button>
                        ))}
                </>
            );
        } else {
            return (
                <div className='auth-actions'>
                    <Button
                        tertiary
                        onClick={() => {
                            window.location.replace('https://oauth.deriv.com/oauth2/authorize?app_id=75771&l=EN&brand=tradecortex');
                        }}
                    >
                        <Localize i18n_default_text='Log in' />
                    </Button>
                    <Button
                        primary
                        onClick={() => {
                            window.open('https://track.deriv.com/_cjFwFCL6Iy0KqFKZ7JdnQ2Nd7ZgqdRLk/1/');
                        }}
                    >
                        <Localize i18n_default_text='Sign up' />
                    </Button>
                </div>
            );
        }
    };

    return (
        <Header
            className={clsx('app-header', {
                'app-header--desktop': isDesktop,
                'app-header--mobile': !isDesktop,
            })}
        >
            <Wrapper variant='left'>
                <AppLogo />
                <MobileMenu />
                <InfoIcon />
                <button
                    className="app-header__toggle"
                    onClick={handleToggle}
                    aria-pressed={isToggled}
                >
                    {isToggled ? 'ON' : 'OFF'}
                </button>
            </Wrapper>
            <Wrapper variant='right'>
                <div className="header__menu-right">
                    <ConnectionStatus />
                    <MenuItems />
                </div>
            </Wrapper>

            {isModalOpen && (
                <Modal
                    is_open={isModalOpen}
                    toggleModal={() => setIsModalOpen(false)}
                    title="Select Stake and Martingale"
                >
                    <div className="modal-content">
                        <label>
                            Stake:
                            <input
                                type="number"
                                value={stake}
                                onChange={e => setStake(e.target.value)}
                                placeholder="Enter stake"
                            />
                        </label>
                        <label>
                            Martingale:
                            <input
                                type="number"
                                value={martingale}
                                onChange={e => setMartingale(e.target.value)}
                                placeholder="Enter martingale"
                            />
                        </label>
                        <button onClick={handleProceed} className="proceed-button">
                            Proceed
                        </button>
                    </div>
                </Modal>
            )}
        </Header>
    );
});

export default AppHeader;