// Снимок листа WB из «Мониторинг цен WB и Ozon».
// Используется как стартовая витрина рекомендаций: цены не меняются автоматически.

export type TargetPriceCompetitor = {
  nmId: number;
  url?: string | null;
  price: number;
  source: string | null;
};

export type TargetPriceSnapshotRow = {
  sku: string;
  nmId: number | null;
  orders: number;
  priceBeforeSpp: number | null;
  sppPercent: number | null;
  currentPrice: number | null;
  updatedAt: string | null;
  searchQuery: string | null;
  competitors: TargetPriceCompetitor[];
  candidateNmId: number | null;
  score: number | null;
  reason: string | null;
  sourceStatus: string | null;
};

export const targetPriceSheetUrl = "https://docs.google.com/spreadsheets/d/1taLWpS63CKg681nHdVc0REJqc2PGeyGhS2e2yQbpsic/edit?gid=1392218806#gid=1392218806";
export const targetPriceSnapshotUpdatedAt = "04.08.2026 14:20 МСК";

export const targetPriceSnapshot: TargetPriceSnapshotRow[] = [
  {
    "sku": "Berberis90Б",
    "nmId": 236369257,
    "orders": 6883619,
    "priceBeforeSpp": 1001,
    "sppPercent": 0.04,
    "currentPrice": 962,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Берберин",
    "competitors": [
      {
        "nmId": 757956711,
        "price": 711,
        "source": "ручной"
      },
      {
        "nmId": 836987970,
        "price": 1080,
        "source": "ручной"
      },
      {
        "nmId": 773760604,
        "price": 1327,
        "source": "ручной"
      }
    ],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "готово"
  },
  {
    "sku": "МагнийХелат120Б",
    "nmId": 837635258,
    "orders": 4556669,
    "priceBeforeSpp": 700.05,
    "sppPercent": 0.04,
    "currentPrice": 673,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Магний хелат B6 бисглицинат глицинат 120 капсул по 400мг",
    "competitors": [
      {
        "nmId": 219503618,
        "price": 660,
        "source": "ручной"
      },
      {
        "nmId": 217297881,
        "price": 625,
        "source": "ручной"
      },
      {
        "nmId": 251384120,
        "price": 741,
        "source": "ручной"
      }
    ],
    "candidateNmId": 271426816,
    "score": 0.5746,
    "reason": "Автокандидат WB 271426816; score 0.5746; слот 3; контент 21%; ценовой сегмент 100%; видимость 79%",
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "ExtractEjovik30",
    "nmId": 266703560,
    "orders": 1932111,
    "priceBeforeSpp": 2100,
    "sppPercent": 0.18,
    "currentPrice": 1726,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Жидкий экстракт Ежовик гребенчатый",
    "competitors": [
      {
        "nmId": 806778804,
        "price": 1645,
        "source": "ручной"
      },
      {
        "nmId": 758343976,
        "price": 2171,
        "source": "ручной"
      },
      {
        "nmId": 672835527,
        "price": 1292,
        "source": "ручной"
      }
    ],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "готово"
  },
  {
    "sku": "МагнийЦитрат120Б",
    "nmId": 933631245,
    "orders": 1498990,
    "priceBeforeSpp": 650.04,
    "sppPercent": 0.04,
    "currentPrice": 625,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Магний цитрат",
    "competitors": [
      {
        "nmId": 347398509,
        "price": 706,
        "source": "ручной"
      },
      {
        "nmId": 141931034,
        "price": 769,
        "source": "ручной"
      },
      {
        "nmId": 44798871,
        "price": 577,
        "source": "ручной"
      }
    ],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "готово"
  },
  {
    "sku": "D3+К2_200",
    "nmId": 933603424,
    "orders": 1170120,
    "priceBeforeSpp": 801,
    "sppPercent": 0.04,
    "currentPrice": 770,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Витамины D3+K2 200 капсул",
    "competitors": [
      {
        "nmId": 252670693,
        "price": 857,
        "source": "автозамена"
      },
      {
        "nmId": 707932234,
        "price": 725,
        "source": "автозамена"
      },
      {
        "nmId": 331714334,
        "price": 707,
        "source": "ручной"
      }
    ],
    "candidateNmId": 252670693,
    "score": 0.77,
    "reason": "1194963447 → 252670693, 857 ₽, топ-17; 1194963448 → 707932234, 725 ₽, топ-10",
    "sourceStatus": "автозамена"
  },
  {
    "sku": "ЦинкКарнозин60",
    "nmId": 498878064,
    "orders": 758774,
    "priceBeforeSpp": 2001,
    "sppPercent": 0.18,
    "currentPrice": 1644,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Цинк L-карнозин Гастро",
    "competitors": [
      {
        "nmId": 241874235,
        "price": 1022,
        "source": "ручной"
      },
      {
        "nmId": 448161150,
        "price": 1735,
        "source": "ручной"
      },
      {
        "nmId": 551872169,
        "price": 2137,
        "source": "ручной"
      }
    ],
    "candidateNmId": 262430472,
    "score": 0.6174000000000001,
    "reason": "Автокандидат WB 262430472; score 0.6174; слот 3; контент 33%; ценовой сегмент 86%; видимость 100%",
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Ежовик500/200",
    "nmId": 876874615,
    "orders": 717234,
    "priceBeforeSpp": 1100,
    "sppPercent": 0.04,
    "currentPrice": 1058,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Ежовик гребенчатый Lions Mane мицелий 200 капсул",
    "competitors": [
      {
        "nmId": 985760000,
        "price": 721,
        "source": "ручной"
      },
      {
        "nmId": 149791473,
        "price": 962,
        "source": "ручной"
      },
      {
        "nmId": 421633181,
        "price": 873,
        "source": "ручной"
      }
    ],
    "candidateNmId": 485119193,
    "score": 0.612,
    "reason": "Автокандидат WB 485119193; score 0.6120; слот 1; контент 27%; ценовой сегмент 94%; видимость 98%",
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Мио60",
    "nmId": 504354043,
    "orders": 693104,
    "priceBeforeSpp": 1001.11,
    "sppPercent": 0.04,
    "currentPrice": 963,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Мио инозитол 1000 мг витамины для женщин 60 капсул",
    "competitors": [
      {
        "nmId": 185241071,
        "price": 971,
        "source": "ручной"
      },
      {
        "nmId": 136528542,
        "price": 1324,
        "source": "ручной"
      },
      {
        "nmId": 1264098828,
        "price": 1005,
        "source": "ручной"
      }
    ],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "готово"
  },
  {
    "sku": "КоллагенМанго500гр",
    "nmId": 889837725,
    "orders": 641378,
    "priceBeforeSpp": 2001,
    "sppPercent": 0.18,
    "currentPrice": 1644,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Коллаген манго желе натуральный для суставов 500гр",
    "competitors": [
      {
        "nmId": 452867588,
        "price": 1660,
        "source": "ручной"
      },
      {
        "nmId": 347541617,
        "price": 1422,
        "source": "ручной"
      },
      {
        "nmId": 455281661,
        "price": 1660,
        "source": "ручной"
      }
    ],
    "candidateNmId": null,
    "score": null,
    "reason": "Клиентская карточка: Товар недоступен",
    "sourceStatus": "ошибка обновления"
  },
  {
    "sku": "EJOVIKaps120",
    "nmId": 142604767,
    "orders": 626460,
    "priceBeforeSpp": 1001,
    "sppPercent": 0.04,
    "currentPrice": 962,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Ежовик гребенчатый Lions Mane мицелий 120 капсул 500мг",
    "competitors": [
      {
        "nmId": 149732548,
        "price": 1076,
        "source": "ручной"
      },
      {
        "nmId": 149732548,
        "price": 1076,
        "source": "ручной"
      },
      {
        "nmId": 212875225,
        "price": 962,
        "source": "ручной"
      }
    ],
    "candidateNmId": null,
    "score": null,
    "reason": "Дубль конкурента в ручном списке",
    "sourceStatus": "проверить дубль"
  },
  {
    "sku": "СлимМикс60",
    "nmId": 879626892,
    "orders": 623326,
    "priceBeforeSpp": 675.08,
    "sppPercent": 0.04,
    "currentPrice": 649,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Берберин с хромом",
    "competitors": [
      {
        "nmId": 757956711,
        "price": 711,
        "source": "ручной"
      },
      {
        "nmId": 836987970,
        "price": 1080,
        "source": "ручной"
      },
      {
        "nmId": 773760604,
        "price": 1327,
        "source": "ручной"
      }
    ],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "готово"
  },
  {
    "sku": "Artishok90",
    "nmId": 285860936,
    "orders": 546791,
    "priceBeforeSpp": 730,
    "sppPercent": 0.04,
    "currentPrice": 702,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Артишок",
    "competitors": [
      {
        "nmId": 1214400386,
        "price": 599,
        "source": "ручной"
      },
      {
        "nmId": 913035269,
        "price": 846,
        "source": "ручной"
      },
      {
        "nmId": 273979666,
        "price": 633,
        "source": "автозамена"
      }
    ],
    "candidateNmId": 273979666,
    "score": 0.96,
    "reason": "542525762 → 273979666, 633 ₽, топ-1",
    "sourceStatus": "автозамена"
  },
  {
    "sku": "Гинкго60",
    "nmId": 879404447,
    "orders": 521248,
    "priceBeforeSpp": 690.06,
    "sppPercent": 0.04,
    "currentPrice": 663,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Экстракт Гинкго Билоба",
    "competitors": [
      {
        "nmId": 166317209,
        "price": 566,
        "source": "ручной"
      },
      {
        "nmId": 1109824552,
        "price": 601,
        "source": "ручной"
      },
      {
        "nmId": 149734943,
        "price": 714,
        "source": "автозамена"
      }
    ],
    "candidateNmId": 149734943,
    "score": 0.9,
    "reason": "1179577919 → 149734943, 714 ₽, топ-6",
    "sourceStatus": "автозамена"
  },
  {
    "sku": "Cimicifuga60",
    "nmId": 316653378,
    "orders": 495836,
    "priceBeforeSpp": 700,
    "sppPercent": 0.04,
    "currentPrice": 673,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Цимицифуга витамины для женщин 60 капсул",
    "competitors": [
      {
        "nmId": 229286275,
        "price": 831,
        "source": "ручной"
      },
      {
        "nmId": 231792312,
        "price": 509,
        "source": "ручной"
      },
      {
        "nmId": 786005238,
        "price": 816,
        "source": "ручной"
      }
    ],
    "candidateNmId": 876524063,
    "score": 0.5573,
    "reason": "Автокандидат WB 876524063; score 0.5573; слот 1; контент 16%; ценовой сегмент 97%; видимость 91%",
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "СеррапептазаНаттокиназа90",
    "nmId": 876917247,
    "orders": 469202,
    "priceBeforeSpp": 2001.02,
    "sppPercent": 0.18,
    "currentPrice": 1644,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Для крепкого сердца серрапептаза",
    "competitors": [
      {
        "nmId": 1055669972,
        "price": 1664,
        "source": "ручной"
      },
      {
        "nmId": 333386083,
        "price": 1647,
        "source": "ручной"
      },
      {
        "nmId": 303864013,
        "price": 2502,
        "source": "ручной"
      }
    ],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "готово"
  },
  {
    "sku": "СеленЛаминария60",
    "nmId": 516965339,
    "orders": 427264,
    "priceBeforeSpp": 601,
    "sppPercent": 0.04,
    "currentPrice": 578,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": null,
    "competitors": [
      {
        "nmId": 217132579,
        "price": 392,
        "source": "ручной"
      },
      {
        "nmId": 40661829,
        "price": 609,
        "source": "ручной"
      },
      {
        "nmId": 254604077,
        "price": 318,
        "source": "ручной"
      }
    ],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "готово"
  },
  {
    "sku": "ЖелезоГранат60Б",
    "nmId": 879602139,
    "orders": 426657,
    "priceBeforeSpp": 601.02,
    "sppPercent": 0.04,
    "currentPrice": 578,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Железо витамины хелат бисглицинат для женщин",
    "competitors": [
      {
        "nmId": 200316228,
        "price": 333,
        "source": "ручной"
      },
      {
        "nmId": 338407357,
        "price": 334,
        "source": "ручной"
      },
      {
        "nmId": 169227704,
        "price": 441,
        "source": "ручной"
      }
    ],
    "candidateNmId": 164475672,
    "score": 0.575,
    "reason": "Автокандидат WB 164475672; score 0.5750; слот 2; контент 27%; ценовой сегмент 87%; видимость 89%",
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "TaurinJenshen90",
    "nmId": 252812002,
    "orders": 415386,
    "priceBeforeSpp": 670,
    "sppPercent": 0.04,
    "currentPrice": 644,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Таурин Женьшень для энергии и бодрости",
    "competitors": [
      {
        "nmId": 174174763,
        "price": 295,
        "source": "ручной"
      },
      {
        "nmId": 443796777,
        "price": 1100,
        "source": "автозамена"
      },
      {
        "nmId": 1110725694,
        "price": 686,
        "source": "ручной"
      }
    ],
    "candidateNmId": 443796777,
    "score": 0.75,
    "reason": "70104406 → 443796777, 1100 ₽, топ-2",
    "sourceStatus": "автозамена"
  },
  {
    "sku": "Rastoropsha60",
    "nmId": 233238573,
    "orders": 405162,
    "priceBeforeSpp": 555,
    "sppPercent": 0.04,
    "currentPrice": 533,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Расторопша для печени",
    "competitors": [
      {
        "nmId": 327457413,
        "price": 550,
        "source": "ручной"
      },
      {
        "nmId": 315165942,
        "price": 673,
        "source": "ручной"
      },
      {
        "nmId": 212875288,
        "price": 402,
        "source": "ручной"
      }
    ],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "готово"
  },
  {
    "sku": "Антипаразит60",
    "nmId": 481712761,
    "orders": 403279,
    "priceBeforeSpp": 601,
    "sppPercent": 0.04,
    "currentPrice": 578,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Антипаразитарный натуральный комплекс",
    "competitors": [
      {
        "nmId": 933777377,
        "price": 612,
        "source": "ручной"
      },
      {
        "nmId": 17391995,
        "price": 1047,
        "source": "ручной"
      },
      {
        "nmId": 293329065,
        "price": 1076,
        "source": "ручной"
      }
    ],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "готово"
  },
  {
    "sku": "KapsCord200",
    "nmId": 162377934,
    "orders": 393821,
    "priceBeforeSpp": 1400,
    "sppPercent": 0.04,
    "currentPrice": 1346,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Кордицепс для выносливости 200 капсул",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Бамбук60",
    "nmId": 879561172,
    "orders": 330331,
    "priceBeforeSpp": 700,
    "sppPercent": 0.04,
    "currentPrice": 673,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Кремний витамины из экстракта бамбука 250 мг для красоты",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "АльфалипоеваяКислота60",
    "nmId": 504338734,
    "orders": 327631,
    "priceBeforeSpp": 601,
    "sppPercent": 0.04,
    "currentPrice": 578,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Альфа липоевая кислота для похудения и снижения аппетита",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Липотропный90",
    "nmId": 933631246,
    "orders": 326118,
    "priceBeforeSpp": 1001,
    "sppPercent": 0.04,
    "currentPrice": 962,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Липотропный фактор 90 капсул",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "NewKapsEJ120",
    "nmId": 214934975,
    "orders": 321299,
    "priceBeforeSpp": 1001,
    "sppPercent": 0.04,
    "currentPrice": 962,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Ежовик гребенчатый Lions Mane мицелий 120 капсул 700мг",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Жиросжигатель60",
    "nmId": 552529440,
    "orders": 304193,
    "priceBeforeSpp": 670,
    "sppPercent": 0.04,
    "currentPrice": 644,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Мощный жиросжигатель Fat Burner для похудения",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Холин_120",
    "nmId": 1001364884,
    "orders": 291028,
    "priceBeforeSpp": 1001.11,
    "sppPercent": 0.04,
    "currentPrice": 963,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Холин 120 капсул",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Лопух120",
    "nmId": 879626890,
    "orders": 273385,
    "priceBeforeSpp": 654.36,
    "sppPercent": 0.04,
    "currentPrice": 629,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Корень лопуха экстракт",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "КоллагенВаниль500гр",
    "nmId": 889837727,
    "orders": 271596,
    "priceBeforeSpp": 2001,
    "sppPercent": 0.18,
    "currentPrice": 1644,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Коллаген ваниль желе натуральный для суставов 500гр",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Глутатион60Б",
    "nmId": 879580281,
    "orders": 227342,
    "priceBeforeSpp": 1001,
    "sppPercent": 0.04,
    "currentPrice": 962,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Глутатион",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "KurkuPeper60",
    "nmId": 252812005,
    "orders": 212883,
    "priceBeforeSpp": 690,
    "sppPercent": 0.04,
    "currentPrice": 663,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Куркумин с пиперином биоперином 60 капсул",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Maka90",
    "nmId": 815838177,
    "orders": 193257,
    "priceBeforeSpp": 710.01,
    "sppPercent": 0.04,
    "currentPrice": 683,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "650 мг для гормонального баланса",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Уридин+В6_60",
    "nmId": 933631243,
    "orders": 190558,
    "priceBeforeSpp": 1400,
    "sppPercent": 0.04,
    "currentPrice": 1346,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Уридин",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Левзея200",
    "nmId": 879626894,
    "orders": 168570,
    "priceBeforeSpp": 1100,
    "sppPercent": 0.04,
    "currentPrice": 1058,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Экстракт левзеи маралий корень 200 капсул",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Коэнзим90",
    "nmId": 542335800,
    "orders": 162555,
    "priceBeforeSpp": 670,
    "sppPercent": 0.04,
    "currentPrice": 644,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Коэнзим Q10 убихинон",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Дим60Б",
    "nmId": 890147917,
    "orders": 152652,
    "priceBeforeSpp": 1150,
    "sppPercent": 0.04,
    "currentPrice": 1106,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "DIM дииндолилметан",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Астаксантин60",
    "nmId": 879580280,
    "orders": 149341,
    "priceBeforeSpp": 601.12,
    "sppPercent": 0.04,
    "currentPrice": 578,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Астаксантин натуральный для глаз и зрения 60 капсул",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Цинк120",
    "nmId": 498879450,
    "orders": 139864,
    "priceBeforeSpp": 620.05,
    "sppPercent": 0.04,
    "currentPrice": 596,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Цинк хелат бисглицинат для энергии и иммунитета",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "SawPalmetto90",
    "nmId": 365942062,
    "orders": 130802,
    "priceBeforeSpp": 1100,
    "sppPercent": 0.04,
    "currentPrice": 1058,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Со пальметто для мужского здоровья",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "L-карнитин90",
    "nmId": 491437562,
    "orders": 129162,
    "priceBeforeSpp": 601,
    "sppPercent": 0.04,
    "currentPrice": 578,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "L Карнитин carnitine спортивный жиросжигатель для похудения",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "РозмаринМасло30",
    "nmId": 933545209,
    "orders": 123978,
    "priceBeforeSpp": 460,
    "sppPercent": 0.02,
    "currentPrice": 451,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Масло розмарина для роста волос 30 мл",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "KapsCord60",
    "nmId": 162377931,
    "orders": 122807,
    "priceBeforeSpp": 400,
    "sppPercent": 0.02,
    "currentPrice": 392,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Кордицепс для выносливости 60 капсул по 500 мг",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "MensMix1_90",
    "nmId": 370499981,
    "orders": 113492,
    "priceBeforeSpp": 670,
    "sppPercent": 0.04,
    "currentPrice": 644,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Женьшень Mens mix - тонгкат али",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Монолаурин60",
    "nmId": 494967865,
    "orders": 109544,
    "priceBeforeSpp": 800,
    "sppPercent": 0.04,
    "currentPrice": 769,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Монолаурин",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Trametes90",
    "nmId": 388099389,
    "orders": 105243,
    "priceBeforeSpp": 601,
    "sppPercent": 0.04,
    "currentPrice": 578,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Траметес разноцветный по 550мг энергия и детокс",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Монарда30",
    "nmId": 933545210,
    "orders": 92657,
    "priceBeforeSpp": 390.05,
    "sppPercent": 0.02,
    "currentPrice": 383,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Монарда экстракт 30 мл",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Глицин+B6_90",
    "nmId": 933631244,
    "orders": 92515,
    "priceBeforeSpp": 450.03,
    "sppPercent": 0.02,
    "currentPrice": 441,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Глицин",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Левзея60",
    "nmId": 879626893,
    "orders": 89138,
    "priceBeforeSpp": 650.1,
    "sppPercent": 0.04,
    "currentPrice": 625,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Экстракт левзеи маралий корень 60 капсул",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "KapsCord120",
    "nmId": 815838156,
    "orders": 81481,
    "priceBeforeSpp": 776.04,
    "sppPercent": 0.04,
    "currentPrice": 746,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Кордицепс для выносливости 120 капсул по 500 мг",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Гинкго120",
    "nmId": 879404446,
    "orders": 79607,
    "priceBeforeSpp": 800,
    "sppPercent": 0.29,
    "currentPrice": 568,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": null,
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": "Клиентская карточка: Карточка WB не найдена",
    "sourceStatus": "ошибка обновления"
  },
  {
    "sku": "ejoveс300",
    "nmId": 235331789,
    "orders": 76801,
    "priceBeforeSpp": 2001.06,
    "sppPercent": 0.18,
    "currentPrice": 1644,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Ежовик гребенчатый порошок - Мицелий - 300 грамм",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Чага60",
    "nmId": 879626895,
    "orders": 75741,
    "priceBeforeSpp": 470.4,
    "sppPercent": 0.02,
    "currentPrice": 461,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Чага Экстракт березовая алтайская 60 капсул по 500 мг",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "KapsCord90",
    "nmId": 162377932,
    "orders": 57204,
    "priceBeforeSpp": 601,
    "sppPercent": 0.04,
    "currentPrice": 578,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Кордицепс для выносливости 90 капсул по 500 мг",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Лопух60",
    "nmId": 879626891,
    "orders": 46953,
    "priceBeforeSpp": 450,
    "sppPercent": 0.02,
    "currentPrice": 441,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": "Корень лопуха экстракт",
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": null,
    "sourceStatus": "нужен подбор"
  },
  {
    "sku": "Чага200",
    "nmId": 879626896,
    "orders": 44357,
    "priceBeforeSpp": 1200.14,
    "sppPercent": 0.27,
    "currentPrice": 876,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": null,
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": "Клиентская карточка: Товар недоступен",
    "sourceStatus": "ошибка обновления"
  },
  {
    "sku": "Cord200",
    "nmId": 203635924,
    "orders": 0,
    "priceBeforeSpp": 1155.04,
    "sppPercent": 0.19,
    "currentPrice": 1282.09,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": null,
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": "Клиентская карточка: Товар недоступен",
    "sourceStatus": "ошибка обновления"
  },
  {
    "sku": "TaurinJenshen150",
    "nmId": 252812010,
    "orders": 0,
    "priceBeforeSpp": 608.02,
    "sppPercent": 0.25,
    "currentPrice": 456.02,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": null,
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": "Клиентская карточка: Товар недоступен",
    "sourceStatus": "ошибка обновления"
  },
  {
    "sku": "KurkuPeper150",
    "nmId": 252812011,
    "orders": 0,
    "priceBeforeSpp": 690,
    "sppPercent": 0.31,
    "currentPrice": 476.1,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": null,
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": "Клиентская карточка: Товар недоступен",
    "sourceStatus": "ошибка обновления"
  },
  {
    "sku": "MensMix1_150",
    "nmId": 467517316,
    "orders": 0,
    "priceBeforeSpp": 930,
    "sppPercent": 0.3,
    "currentPrice": 651,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": null,
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": "Клиентская карточка: Товар недоступен",
    "sourceStatus": "ошибка обновления"
  },
  {
    "sku": "L-теанин+B6_90",
    "nmId": 1001364883,
    "orders": 0,
    "priceBeforeSpp": 2000,
    "sppPercent": 0,
    "currentPrice": 2000,
    "updatedAt": "04.08.2026 14:20:51",
    "searchQuery": null,
    "competitors": [],
    "candidateNmId": null,
    "score": null,
    "reason": "Клиентская карточка: Карточка WB не найдена",
    "sourceStatus": "ошибка обновления"
  }
];
