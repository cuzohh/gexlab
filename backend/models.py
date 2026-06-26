from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict


class RootResponse(BaseModel):
    message: str


class HealthResponse(BaseModel):
    status: str
    service: str
    polling: bool


class ErrorResponse(BaseModel):
    error: str


class RawContractModel(BaseModel):
    model_config = ConfigDict(extra="allow")

    expiry: str
    type: str
    strike: float
    openInterest: Optional[float] = None
    impliedVolatility: Optional[float] = None
    volume: Optional[float] = None
    delta: Optional[float] = None
    gamma: Optional[float] = None
    vega: Optional[float] = None
    theta: Optional[float] = None
    vanna: Optional[float] = None
    charm: Optional[float] = None
    iv: Optional[float] = None
    gex: Optional[float] = None
    dex: Optional[float] = None
    vex: Optional[float] = None
    chex: Optional[float] = None


class StrikeAnalyticsModel(BaseModel):
    strike: float
    gex: float
    dex: float
    vex: float
    chex: float
    openInterest: float
    volume: float
    iv: float


class SurfaceDataModel(BaseModel):
    expiries: List[str]
    strikes: List[float]
    matrix: List[List[float]]


class MajorWallModel(BaseModel):
    strike: float
    gex: float


class MajorWallsModel(BaseModel):
    calls: List[MajorWallModel]
    puts: List[MajorWallModel]


class DexLevelsModel(BaseModel):
    flip: Optional[float] = None
    callWall: Optional[float] = None
    putWall: Optional[float] = None
    majorWalls: Optional[MajorWallsModel] = None


class DerivedLevelsModel(BaseModel):
    sessionFloor: Optional[float] = None
    oiCallWall: Optional[float] = None
    oiPutWall: Optional[float] = None
    weakCallOIStrike: Optional[float] = None
    weakPutOIStrike: Optional[float] = None
    protectedGammaHigh: Optional[float] = None
    protectedGammaLow: Optional[float] = None
    aggressiveCallCeiling: Optional[float] = None
    aggressivePutFloor: Optional[float] = None
    skewRichStrike: Optional[float] = None
    skewCheapStrike: Optional[float] = None


class BaseLevelsModel(BaseModel):
    gammaFlip: float
    callWall: Optional[float] = None
    putWall: Optional[float] = None
    sessionCeiling: Optional[float] = None
    maxPain: float
    vannaMagnet: float
    majorWalls: Optional[MajorWallsModel] = None
    dex: Optional[DexLevelsModel] = None
    derived: Optional[DerivedLevelsModel] = None


class DteLevelsModel(BaseLevelsModel):
    dte: int
    expiry: str


class LevelsModel(BaseLevelsModel):
    byDte: List[DteLevelsModel] = []


class AnalyticsSummaryModel(BaseModel):
    totalNetGex: float
    totalNetDex: float
    spotPrice: float
    riskFreeRate: float
    timestamp: str


class AnalyticsResponse(BaseModel):
    summary: AnalyticsSummaryModel
    strikes: List[StrikeAnalyticsModel]
    surface: SurfaceDataModel
    raw: List[RawContractModel]
    levels: Optional[LevelsModel] = None


class RawMetricsResponse(BaseModel):
    metrics: Dict[str, Dict[str, Any]]
    basis: Dict[str, Dict[str, Any]]


class BridgePayloadResponse(BaseModel):
    payload: str
    timestamp: Optional[str] = None
    error: Optional[str] = None


class SnapshotDatesResponse(BaseModel):
    ticker: str
    dates: List[str]


class SnapshotResponse(BaseModel):
    ticker: str
    date: str
    savedAt: str
    source: str
    raw: Dict[str, Any]
    basis: Dict[str, Any]
    analytics: AnalyticsResponse


class MacroEventModel(BaseModel):
    date: str
    label: str
    source: str
    category: str
    impact: str
    note: str
    releaseTimeEt: Optional[str] = None
    expected: Optional[str] = None
    actual: Optional[str] = None
    previous: Optional[str] = None


class MacroEventsResponse(BaseModel):
    events: List[MacroEventModel]
