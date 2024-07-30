/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt, log } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD, UNTRACKED_PAIRS } from './helpers'

const WMATIC_ADDRESS = '0x094616f0bdfb0b526bd735bf66eca0ad254ca81f'
const MONT_ADDRESS = '0x9087f345f063b88a78b80d90eeb1da35288d183a'

export function getEthPriceInUSD(): BigDecimal {
  return ONE_BD
}

let WHITELIST: string[] = [
  '0x2D9ee688D46FD1D39Eb3507BB58dCE3A3cab64D0', // ARDM
  MONT_ADDRESS // MONT
]

let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('2')
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('0')

export function findMntPerToken(token: Token): BigDecimal {
  if (token.id == MONT_ADDRESS) {
    return ONE_BD
  }

  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))

    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())

      if (pair !== null) {
        if (pair.token0 == token.id) {
          let token0 = Token.load(pair.token0)
          let token1 = Token.load(pair.token1)

          if (token0 !== null && token1 !== null) {
            return pair.token1Price.times(token1.mnt as BigDecimal)
          }
        }

        if (pair.token1 == token.id) {
          let token0 = Token.load(pair.token0)
          let token1 = Token.load(pair.token1)

          if (token0 !== null && token1 !== null) {
            return pair.token0Price.times(token0.mnt as BigDecimal)
          }
        }
      }
    }
  }

  return ZERO_BD
}

export function getVolumeMNT(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  return pair.volumeToken0
    .times(token0.mnt)
    .plus(pair.volumeToken1.times(token1.mnt))
    .div(BigDecimal.fromString('2'))
}

export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WMATIC_ADDRESS) {
    return ONE_BD
  }

  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))

    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())

      if (pair !== null) {
        if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
          let token1 = Token.load(pair.token1)
          if (token1 !== null) {
            return pair.token1Price.times(token1.derivedETH as BigDecimal)
          }
        }

        if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
          let token0 = Token.load(pair.token0)
          if (token0 !== null) {
            return pair.token0Price.times(token0.derivedETH as BigDecimal)
          }
        }
      }
    }
  }
  return ZERO_BD
}

function getSafePrice(value: BigDecimal | null, defaultValue: BigDecimal): BigDecimal {
  return value !== null ? value : defaultValue
}

export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')

  if (bundle === null) {
    return ZERO_BD
  }

  let price0 = getSafePrice(token0.derivedETH, ZERO_BD).times(bundle.ethPrice)
  let price1 = getSafePrice(token1.derivedETH, ZERO_BD).times(bundle.ethPrice)

  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)

    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }

    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }

    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  return ZERO_BD
}

export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')

  if (bundle === null) {
    return ZERO_BD
  }

  let price0 = getSafePrice(token0.derivedETH, ZERO_BD).times(bundle.ethPrice)
  let price1 = getSafePrice(token1.derivedETH, ZERO_BD).times(bundle.ethPrice)

  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  return ZERO_BD
}
