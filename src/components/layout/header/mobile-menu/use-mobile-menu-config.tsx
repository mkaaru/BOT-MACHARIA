import { ComponentProps, ReactNode } from 'react';
import Livechat from '@/components/chat/Livechat';
import useIsLiveChatWidgetAvailable from '@/components/chat/useIsLiveChatWidgetAvailable';
import { standalone_routes } from '@/components/shared';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import useRemoteConfig from '@/hooks/growthbook/useRemoteConfig';
import { useIsIntercomAvailable } from '@/hooks/useIntercom';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import RootStore from '@/stores/root-store';
import {
    LegacyAccountLimitsIcon,
    LegacyCashierIcon,
    LegacyChartsIcon,
    LegacyHelpCentreIcon,
    LegacyHomeOldIcon,
    LegacyLogout1pxIcon,
    LegacyProfileSmIcon,
    LegacyResponsibleTradingIcon,
    LegacyTheme1pxIcon,
    LegacyWhatsappIcon,
} from '@deriv/quill-icons/Legacy';
import { BrandDerivLogoCoralIcon } from '@deriv/quill-icons/Logo';
import { useTranslations } from '@deriv-com/translations';
import { ToggleSwitch } from '@deriv-com/ui';
import { URLConstants } from '@deriv-com/utils';
import { useStore } from '@/hooks/useStore';
import { requestOidcAuthentication } from '@deriv-com/auth-client';

export type TSubmenuSection = 'accountSettings' | 'cashier';

//IconTypes
type TMenuConfig = {
    LeftComponent: ReactNode | React.ElementType;
    RightComponent?: ReactNode;
    as: 'a' | 'button';
    href?: string;
    label: ReactNode;
    onClick?: () => void;
    removeBorderBottom?: boolean;
    submenu?: TSubmenuSection;
    target?: ComponentProps<'a'>['target'];
}[];

const useMobileMenuConfig = ({ oAuthLogout }: { oAuthLogout: () => Promise<void> }) => {
    const store = useStore();
    const { ui, client } = store || {};
    const { localize } = useTranslations();
    const { is_logged_in } = ui || {};
    const { isOAuth2Enabled } = useOauth2({ client });

    // Return empty config if store is not ready
    if (!store || !client || !ui) {
        return {
            config: []
        };
    }

    const handleMobileLogin = () => {
        if (isOAuth2Enabled) {
            requestOidcAuthentication({
                redirectCallbackUri: `${window.location.origin}/callback`,
            });
        } else {
            window.location.href = 'https://oauth.deriv.com/oauth2/authorize';
        }
    };

    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();

    const { data } = useRemoteConfig(true);
    const { cs_chat_whatsapp } = data;

    const { is_livechat_available } = useIsLiveChatWidgetAvailable();
    const icAvailable = useIsIntercomAvailable();

    const menuConfig: TMenuConfig[] = [
        [
            {
                as: 'a',
                href: 'https://derivlite.com',
                label: localize('derivlite.com'),
                LeftComponent: BrandDerivLogoCoralIcon,
            },
            {
                as: 'button',
                label: localize('Dark theme'),
                LeftComponent: LegacyTheme1pxIcon,
                RightComponent: <ToggleSwitch value={is_dark_mode_on} onChange={toggleTheme} />,
            },
        ],
        (
            [
                cs_chat_whatsapp
                    ? {
                          as: 'a',
                          href: 'https://chat.whatsapp.com/DoaEcjPhMoy0j6h4euMpsA',
                          label: localize('WhatsApp'),
                          LeftComponent: LegacyWhatsappIcon,
                          target: '_blank',
                      }
                    : null,
                is_livechat_available || icAvailable
                    ? {
                          as: 'button',
                          label: localize('Live chat'),
                          LeftComponent: Livechat,
                          onClick: () => {
                              icAvailable ? window.Intercom('show') : window.LiveChatWidget?.call('maximize');
                          },
                      }
                    : null,
            ] as TMenuConfig
        ).filter(Boolean),
        client?.is_logged_in
            ? [
                  {
                      as: 'button',
                      label: localize('Log out'),
                      LeftComponent: LegacyLogout1pxIcon,
                      onClick: oAuthLogout,
                      removeBorderBottom: true,
                  },
              ]
            : [
                  {
                      as: 'button',
                      label: localize('Log in'),
                      LeftComponent: LegacyLogout1pxIcon,
                      onClick: handleMobileLogin,
                      removeBorderBottom: true,
                  },
              ],
    ];

    return {
        config: menuConfig,
    };
};

export default useMobileMenuConfig;