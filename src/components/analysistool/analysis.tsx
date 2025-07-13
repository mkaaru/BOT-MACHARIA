const AnalysistoolComponent = () => {
    return (
        <iframe
            id='trading-view-iframe'
            style={{ width: '100%', height: '100%', backgroundColor: 'white' }}
            src='https://bot-analysis-tool-belex.web.app'
            title="Bot Analysis Tool"
            className="responsive-iframe"
            allowFullScreen
        />
    );
};

export default AnalysistoolComponent;
