import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { AnalyticsInitializer } from './utils/analytics';
import './styles/index.scss';

try {
    AnalyticsInitializer();
    
    const rootElement = document.getElementById('root');
    if (rootElement) {
        ReactDOM.createRoot(rootElement).render(<AuthWrapper />);
    } else {
        console.error('Root element not found');
    }
} catch (error) {
    console.error('Error initializing app:', error);
}