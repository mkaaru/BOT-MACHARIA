
export interface ContractConfig {
  needsBarrier: boolean;
  needsBarrier2: boolean;
  minStake: number;
  maxStake: number;
  defaultDuration: number;
  durationUnit: string;
  supportedSymbols: string[];
  barrierRange?: { min: number; max: number };
  additionalParams?: Record<string, any>;
}

export const CONTRACT_CONFIGS: Record<string, ContractConfig> = {
  DIGITOVER: {
    needsBarrier: true,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 1,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'],
    barrierRange: { min: 0, max: 9 }
  },
  DIGITUNDER: {
    needsBarrier: true,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 1,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'],
    barrierRange: { min: 0, max: 9 }
  },
  DIGITEVEN: {
    needsBarrier: false,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 1,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100']
  },
  DIGITODD: {
    needsBarrier: false,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 1,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100']
  },
  DIGITDIFF: {
    needsBarrier: true,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 1,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'],
    barrierRange: { min: 0, max: 9 }
  },
  DIGITMATCH: {
    needsBarrier: true,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 1,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'],
    barrierRange: { min: 0, max: 9 }
  },
  CALL: {
    needsBarrier: false,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 1,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD', 'frxUSDJPY']
  },
  PUT: {
    needsBarrier: false,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 1,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD', 'frxUSDJPY']
  },
  ONETOUCH: {
    needsBarrier: true,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 5,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD'],
    barrierRange: { min: 0.001, max: 1000 }
  },
  NOTOUCH: {
    needsBarrier: true,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 5,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD'],
    barrierRange: { min: 0.001, max: 1000 }
  },
  RANGE: {
    needsBarrier: true,
    needsBarrier2: true,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 5,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD'],
    barrierRange: { min: 0.001, max: 1000 }
  },
  UPORDOWN: {
    needsBarrier: true,
    needsBarrier2: true,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 5,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD'],
    barrierRange: { min: 0.001, max: 1000 }
  },
  ASIANU: {
    needsBarrier: false,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 5,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD']
  },
  ASIAND: {
    needsBarrier: false,
    needsBarrier2: false,
    minStake: 0.35,
    maxStake: 1000,
    defaultDuration: 5,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD']
  },
  LBFLOATCALL: {
    needsBarrier: false,
    needsBarrier2: false,
    minStake: 1,
    maxStake: 500,
    defaultDuration: 5,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD']
  },
  LBFLOATPUT: {
    needsBarrier: false,
    needsBarrier2: false,
    minStake: 1,
    maxStake: 500,
    defaultDuration: 5,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD']
  },
  LBHIGHLOW: {
    needsBarrier: false,
    needsBarrier2: false,
    minStake: 1,
    maxStake: 500,
    defaultDuration: 5,
    durationUnit: 't',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD']
  },
  MULTUP: {
    needsBarrier: false,
    needsBarrier2: false,
    minStake: 1,
    maxStake: 2000,
    defaultDuration: 0,
    durationUnit: 's',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD', 'frxUSDJPY'],
    additionalParams: {
      multiplier: 10,
      product_type: 'basic',
      limit_order: {
        stop_loss: 0,
        take_profit: 0
      }
    }
  },
  MULTDOWN: {
    needsBarrier: false,
    needsBarrier2: false,
    minStake: 1,
    maxStake: 2000,
    defaultDuration: 0,
    durationUnit: 's',
    supportedSymbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'frxEURUSD', 'frxGBPUSD', 'frxUSDJPY'],
    additionalParams: {
      multiplier: 10,
      product_type: 'basic',
      limit_order: {
        stop_loss: 0,
        take_profit: 0
      }
    }
  }
};

export const getContractConfig = (contractType: string): ContractConfig => {
  return CONTRACT_CONFIGS[contractType] || CONTRACT_CONFIGS.CALL;
};

export const validateContractParameters = (
  contractType: string,
  stake: number,
  barrier?: number,
  barrier2?: number,
  symbol?: string
): { isValid: boolean; errors: string[] } => {
  const config = getContractConfig(contractType);
  const errors: string[] = [];

  // Validate stake
  if (stake < config.minStake) {
    errors.push(`Minimum stake for ${contractType} is ${config.minStake}`);
  }
  if (stake > config.maxStake) {
    errors.push(`Maximum stake for ${contractType} is ${config.maxStake}`);
  }

  // Validate barrier
  if (config.needsBarrier && barrier === undefined) {
    errors.push(`${contractType} requires a barrier value`);
  }
  if (config.needsBarrier && barrier !== undefined && config.barrierRange) {
    if (barrier < config.barrierRange.min || barrier > config.barrierRange.max) {
      errors.push(`Barrier for ${contractType} must be between ${config.barrierRange.min} and ${config.barrierRange.max}`);
    }
  }

  // Validate second barrier for range contracts
  if (config.needsBarrier2 && barrier2 === undefined) {
    errors.push(`${contractType} requires a second barrier value`);
  }

  // Validate symbol
  if (symbol && !config.supportedSymbols.includes(symbol)) {
    errors.push(`Symbol ${symbol} is not supported for ${contractType}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const getContractDisplayName = (contractType: string): string => {
  const displayNames: Record<string, string> = {
    DIGITOVER: 'Over',
    DIGITUNDER: 'Under',
    DIGITEVEN: 'Even',
    DIGITODD: 'Odd',
    DIGITDIFF: 'Differs',
    DIGITMATCH: 'Matches',
    CALL: 'Rise',
    PUT: 'Fall',
    ONETOUCH: 'Touch',
    NOTOUCH: 'No Touch',
    RANGE: 'Stays Between',
    UPORDOWN: 'Goes Outside',
    ASIANU: 'Asian Rise',
    ASIAND: 'Asian Fall',
    LBFLOATCALL: 'Lookback High Close',
    LBFLOATPUT: 'Lookback Low Close',
    LBHIGHLOW: 'Lookback High Low',
    MULTUP: 'Multiplier Up',
    MULTDOWN: 'Multiplier Down'
  };
  
  return displayNames[contractType] || contractType;
};
