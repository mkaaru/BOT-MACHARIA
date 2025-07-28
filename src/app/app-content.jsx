import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import Main from '@/pages/main';

const AppContent = observer(() => {
    const { common } = useStore();

    return (
        <div className="app-content">
            <Routes>
                <Route path="/" element={<Main />} />
                <Route path="/main" element={<Main />} />
                <Route path="*" element={<Main />} />
            </Routes>
        </div>
    );
});

export default AppContent;