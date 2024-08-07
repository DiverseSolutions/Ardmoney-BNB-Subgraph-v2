/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt, log } from '@graphprotocol/graph-ts'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD, UNTRACKED_PAIRS } from './helpers'

const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
const MONT_ADDRESS = '0x2d279fdecdf7f5705f5ff0bd80f8d9a305ea87f4'
const ARDM_ADDRESS = '0xe849188f76c0da93b5ed310a1f72127914b3a7b9'

export function getEthPriceInUSD(): BigDecimal {
  return ONE_BD
}

let WHITELIST: string[] = [
  // '0xaf7acb54a773f6c6a4169654eaa8fad755468f50' // WMATIC
  // '0xd26adf1fb375a08760aed4a5bcdd8527c7e191b1', // ARDX
  ARDM_ADDRESS, // ARDM
  MONT_ADDRESS // MONT
]

let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('2')
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('0')

export function findMntPerToken(token: Token): BigDecimal {
  if (token.id == MONT_ADDRESS) {
    return ONE_BD
  }

  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddressResult = factoryContract.try_getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))

    if (pairAddressResult.reverted) {
      return ZERO_BD // Or handle this scenario as needed in your application
    } else {
      // Declare pairAddress here so it's accessible in both if and else blocks
      let pairAddress = pairAddressResult.value

      if (pairAddress.toHexString() != ADDRESS_ZERO) {
        let pair = Pair.load(pairAddress.toHexString())
        if (pair === null) {
          continue
        }
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
  if (token.id == WBNB_ADDRESS) {
    return ONE_BD
  }

  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddressResult = factoryContract.try_getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))

    if (pairAddressResult.reverted) {
      return ZERO_BD // Or handle this scenario as needed in your application
    } else {
      // Declare pairAddress here so it's accessible in both if and else blocks
      let pairAddress = pairAddressResult.value

      if (pairAddress.toHexString() != ADDRESS_ZERO) {
        let pair = Pair.load(pairAddress.toHexString())
        if (pair === null) {
          continue
        }
        if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
          let token1 = Token.load(pair.token1)
          if (token1 === null) {
            continue
          }
          return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
        }
        if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
          let token0 = Token.load(pair.token0)
          if (token0 === null) {
            continue
          }
          return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
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
