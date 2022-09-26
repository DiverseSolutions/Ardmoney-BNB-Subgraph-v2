/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt, log } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD, UNTRACKED_PAIRS } from './helpers'

const WMATIC_ADDRESS = '0x094616f0bdfb0b526bd735bf66eca0ad254ca81f'
const MONT_ADDRESS = '0x9087f345f063b88a78b80d90eeb1da35288d183a'
// const MONT_WMATIC_PAIR = '0xdc13d66ee36e21d6f439847563b8504c2936c249'
// const USDC_WETH_PAIR = '0x2b8920cBdDCc3e85753423eEceCd179cb9232554' // created 10008355
// const DAI_WETH_PAIR = '0xaB57fAf3b573B8ac1ad90255f6cF4E92DbbcCE91' // created block 10042267
// const USDT_WETH_PAIR = '0xECd313e29b85cAf347fb832F80427602030cD3Fc' // created block 10093341

export function getEthPriceInUSD(): BigDecimal {
  return ONE_BD

  // fetch eth prices for each stablecoin
  // let montPair = Pair.load(MONT_WMATIC_PAIR) // mont is token0

  // if (montPair !== null) {
  //   return montPair.token0Price
  // } else {
  //   return ZERO_BD
  // }

  // // fetch eth prices for each stablecoin
  // let daiPair = Pair.load(DAI_WETH_PAIR) // dai is token0
  // let usdcPair = Pair.load(USDC_WETH_PAIR) // usdc is token0
  // let usdtPair = Pair.load(USDT_WETH_PAIR) // usdt is token1

  // // all 3 have been created
  // if (daiPair !== null && usdcPair !== null && usdtPair !== null) {
  //   let totalLiquidityETH = daiPair.reserve1.plus(usdcPair.reserve1).plus(usdtPair.reserve0)
  //   let daiWeight = daiPair.reserve1.div(totalLiquidityETH)
  //   let usdcWeight = usdcPair.reserve1.div(totalLiquidityETH)
  //   let usdtWeight = usdtPair.reserve0.div(totalLiquidityETH)
  //   return daiPair.token0Price
  //     .times(daiWeight)
  //     .plus(usdcPair.token0Price.times(usdcWeight))
  //     .plus(usdtPair.token1Price.times(usdtWeight))
  //   // dai and USDC have been created
  // } else if (daiPair !== null && usdcPair !== null) {
  //   let totalLiquidityETH = daiPair.reserve1.plus(usdcPair.reserve1)
  //   let daiWeight = daiPair.reserve1.div(totalLiquidityETH)
  //   let usdcWeight = usdcPair.reserve1.div(totalLiquidityETH)
  //   return daiPair.token0Price.times(daiWeight).plus(usdcPair.token0Price.times(usdcWeight))
  //   // USDC is the only pair so far
  // } else if (usdcPair !== null) {
  //   return usdcPair.token0Price
  // } else {
  //   return ZERO_BD
  // }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  // '0xaf7acb54a773f6c6a4169654eaa8fad755468f50' // WMATIC
  // '0xd26adf1fb375a08760aed4a5bcdd8527c7e191b1', // ARDX
  '0x2D9ee688D46FD1D39Eb3507BB58dCE3A3cab64D0', // ARDM
  MONT_ADDRESS // MONT
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('2')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('0')

export function findMntPerToken(token: Token): BigDecimal {
  if (token.id == MONT_ADDRESS) {
    return ONE_BD
  }

  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))

    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())

      log.info('galaa another one: ' + token.id, [])
      log.info('galaa pair.token0: ' + pair.token0, [])
      log.info('galaa pair.token1: ' + pair.token1, [])

      if (pair.token0 == token.id) {
        let token0 = Token.load(pair.token0)
        let token1 = Token.load(pair.token1)
        log.info(
          'galaa pair.token1Price: ' +
            pair.token1Price.toString() +
            ', ' +
            token0.mnt.toString() +
            ', ' +
            token1.mnt.toString(),
          []
        )
        return pair.token1Price.times(token1.mnt as BigDecimal)
      }
      if (pair.token1 == token.id) {
        let token0 = Token.load(pair.token0)
        let token1 = Token.load(pair.token1)
        log.info(
          'galaa pair.token0Price: ' +
            pair.token0Price.toString() +
            ', ' +
            token1.mnt.toString() +
            ', ' +
            token0.mnt.toString(),
          []
        )
        return pair.token0Price.times(token0.mnt as BigDecimal)
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

  // return ONE_BD
}

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WMATIC_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))

    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())

      if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token1 = Token.load(pair.token1)
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token0 = Token.load(pair.token0)
        return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // dont count tracked volume on these pairs - usually rebass tokens
  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
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

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
