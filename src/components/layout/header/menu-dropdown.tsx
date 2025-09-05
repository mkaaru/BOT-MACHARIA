
import React, { useState, useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import EnhancedNavigation from './enhanced-navigation';
import './menu-dropdown.scss';

interface MenuDropdownProps {
    trigger: React.ReactNode;
    is_mobile?: boolean;
}

const MenuDropdown = observer(({ trigger, is_mobile = false }: MenuDropdownProps) => {
    const [is_open, setIsOpen] = useState(false);
    const dropdown_ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdown_ref.current && !dropdown_ref.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (is_open) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [is_open]);

    const handleItemClick = () => {
        setIsOpen(false);
    };

    return (
        <div className="menu-dropdown" ref={dropdown_ref}>
            <div 
                className="menu-dropdown__trigger"
                onClick={() => setIsOpen(!is_open)}
            >
                {trigger}
            </div>
            
            {is_open && (
                <div className={`menu-dropdown__content ${is_mobile ? 'menu-dropdown__content--mobile' : ''}`}>
                    <div className="menu-dropdown__header">
                        <h2>Navigation Menu</h2>
                        <button 
                            className="menu-dropdown__close"
                            onClick={() => setIsOpen(false)}
                        >
                            ×
                        </button>
                    </div>
                    <EnhancedNavigation 
                        is_mobile={is_mobile}
                        onItemClick={handleItemClick}
                    />
                </div>
            )}
            
            {is_open && <div className="menu-dropdown__overlay" onClick={() => setIsOpen(false)} />}
        </div>
    );
});

export default MenuDropdown;
