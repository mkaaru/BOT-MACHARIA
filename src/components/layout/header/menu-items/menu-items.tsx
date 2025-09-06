import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useTranslations } from '@deriv-com/translations';
import { MenuItem, Text, useDevice } from '@deriv-com/ui';
import { MenuItems as items, TRADERS_HUB_LINK_CONFIG } from '../header-config';
import './menu-items.scss';

export const MenuItems = observer(() => {
    const { localize } = useTranslations();
    const { isDesktop } = useDevice();
    const store = useStore();
    if (!store) return null;
    const { is_logged_in } = store.client;

    return (
        <>
            {is_logged_in &&
                (isDesktop ? (
                    items.map(({ as, href, icon, label }) => (
                        <MenuItem as={as} className='app-header__menu' href={href} key={label} leftComponent={icon}>
                            <Text>{localize(label)}</Text>
                        </MenuItem>
                    ))
                ) : (
                    <MenuItem
                        as={items[0].as}
                        className='flex gap-2 p-5'
                        href={items[0].href}
                        key={items[0].label}
                        leftComponent={items[0].icon}
                    >
                        <Text>{localize(items[0].label)}</Text>
                    </MenuItem>
                ))}
        </>
    );
});

export const TradershubLink = () => (
    <MenuItem
        as='a'
        className='app-header__menu'
        href={TRADERS_HUB_LINK_CONFIG.href}
        key={TRADERS_HUB_LINK_CONFIG.label}
        leftComponent={TRADERS_HUB_LINK_CONFIG.icon}
    >
        <Text>{TRADERS_HUB_LINK_CONFIG.label}</Text>
    </MenuItem>
);

MenuItems.TradershubLink = TradershubLink;
export default MenuItems;
