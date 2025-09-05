import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { getMenuItems, getAdvancedMenuItems } from './menu-items/menu-items';
import './enhanced-navigation.scss';

interface EnhancedNavigationProps {
    is_mobile?: boolean;
    onItemClick?: () => void;
}

const EnhancedNavigation = observer(({ is_mobile = false, onItemClick }: EnhancedNavigationProps) => {
    const { client, ui } = useStore();
    const { is_logged_in } = client;
    const { current_focus } = ui;

    const menuItems = getMenuItems();
    const advancedItems = getAdvancedMenuItems();

    const handleItemClick = (item: any) => {
        if (item.link_to) {
            // Handle navigation logic here
            window.location.href = item.link_to;
        }
        if (onItemClick) {
            onItemClick();
        }
    };

    const renderMenuItem = (item: any) => {
        const should_show = !item.login_only || is_logged_in;

        if (!should_show) return null;

        return (
            <div
                key={item.id}
                className={`enhanced-nav__item ${current_focus === item.id ? 'enhanced-nav__item--active' : ''}`}
                onClick={() => handleItemClick(item)}
            >
                <div className="enhanced-nav__icon">
                    {/* Icon component would go here */}
                    <span className="enhanced-nav__icon-placeholder">{item.icon}</span>
                </div>
                <span className="enhanced-nav__text">{item.text}</span>
                {item.is_new && <span className="enhanced-nav__badge enhanced-nav__badge--new">New</span>}
                {item.is_premium && <span className="enhanced-nav__badge enhanced-nav__badge--premium">Pro</span>}
            </div>
        );
    };

    return (
        <div className={`enhanced-nav ${is_mobile ? 'enhanced-nav--mobile' : ''}`}>
            <div className="enhanced-nav__section">
                <h3 className="enhanced-nav__section-title">Trading Tools</h3>
                <div className="enhanced-nav__items">
                    {menuItems.slice(0, 6).map(renderMenuItem)}
                </div>
            </div>

            <div className="enhanced-nav__section">
                <h3 className="enhanced-nav__section-title">Analysis & Reports</h3>
                <div className="enhanced-nav__items">
                    {menuItems.slice(6).map(renderMenuItem)}
                </div>
            </div>

            {is_logged_in && (
                <div className="enhanced-nav__section">
                    <h3 className="enhanced-nav__section-title">Advanced Features</h3>
                    <div className="enhanced-nav__items">
                        {advancedItems.map(renderMenuItem)}
                    </div>
                </div>
            )}
        </div>
    );
});

export default EnhancedNavigation;