/**
 * invoice.js - Invoice/Letterhead rendering engine
 * Keeps the original page structure while allowing top-level blank pages
 * to carry their own empty header/details state.
 */
const Invoice = (() => {
  const ITEMS_PER_PAGE_INVOICE = 20;
  const ITEMS_PER_PAGE_LETTERHEAD = 11;
  const INVOICE_FOOTER_LOGO_SRC = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAwIDM1MCIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSI+CiAgPGRlZnM+CiAgICA8bWFzayBpZD0ibXNtZS1tYXNrIj4KICAgICAgPHJlY3QgeD0iLTE1MCIgeT0iLTEwMCIgd2lkdGg9IjMwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IndoaXRlIiAvPgogICAgICA8cmVjdCB4PSItMTUwIiB5PSItNTYiIHdpZHRoPSIzMDAiIGhlaWdodD0iMy41IiBmaWxsPSJibGFjayIgLz4KICAgICAgPHJlY3QgeD0iLTE1MCIgeT0iLTQ1IiB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMuNSIgZmlsbD0iYmxhY2siIC8+CiAgICAgIDxyZWN0IHg9Ii0xNTAiIHk9Ii0zNCIgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzLjUiIGZpbGw9ImJsYWNrIiAvPgogICAgICA8cmVjdCB4PSItMTUwIiB5PSItMjMiIHdpZHRoPSIzMDAiIGhlaWdodD0iMy41IiBmaWxsPSJibGFjayIgLz4KICAgICAgPHJlY3QgeD0iLTE1MCIgeT0iLTEyIiB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMuNSIgZmlsbD0iYmxhY2siIC8+CiAgICA8L21hc2s+CgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJpbmRpYUdyYWQiIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI0ZGOTkzMyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjMzJSIgc3RvcC1jb2xvcj0iI0ZGOTkzMyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjMzJSIgc3RvcC1jb2xvcj0iI0ZGRkZGRiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjY2JSIgc3RvcC1jb2xvcj0iI0ZGRkZGRiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjY2JSIgc3RvcC1jb2xvcj0iIzEzODgwOCIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiMxMzg4MDgiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CgogICAgPHN0eWxlPgogICAgICAudGV4dC1kYXJrIHsgZmlsbDogIzIzMWYyMDsgfQogICAgICAudGV4dC1ncmF5IHsgZmlsbDogIzRhNGE0YTsgfQogICAgICAuYnJhbmQtYmx1ZSB7IGZpbGw6ICMyYTNmOGM7IH0KICAgICAgLmJyYW5kLW9yYW5nZSB7IGZpbGw6ICNmMjY1MjI7IH0KICAgICAgLmJyYW5kLWdyZWVuIHsgZmlsbDogIzhkYzYzZjsgfQogICAgICAKICAgICAgLmZvbnQtc2FucyB7IGZvbnQtZmFtaWx5OiAnTW9udHNlcnJhdCcsICdTZWdvZSBVSScsIHN5c3RlbS11aSwgc2Fucy1zZXJpZjsgfQogICAgICAuZm9udC1zZXJpZiB7IGZvbnQtZmFtaWx5OiAnR2VvcmdpYScsICdUaW1lcyBOZXcgUm9tYW4nLCBzZXJpZjsgfQogICAgICAuZm9udC1pbXBhY3QgeyBmb250LWZhbWlseTogJ0ltcGFjdCcsICdBcmlhbCBCbGFjaycsIHNhbnMtc2VyaWY7IH0KICAgIDwvc3R5bGU+CiAgPC9kZWZzPgoKICA8cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZmZmZmIiAvPgoKICA8ZyBjbGFzcz0iZm9udC1zYW5zIj4KICAgIDx0ZXh0IHg9IjYwIiB5PSIxMDAiIGZvbnQtc2l6ZT0iNDQiIGZvbnQtd2VpZ2h0PSI0MDAiIGNsYXNzPSJ0ZXh0LWdyYXkiPlByb2R1Y3QgYnkgaW5kaWEgTWt0IGJ5PC90ZXh0PgogICAgPHRleHQgeD0iNjAiIHk9IjE1NSIgZm9udC1zaXplPSI1MiIgZm9udC13ZWlnaHQ9IjgwMCIgY2xhc3M9InRleHQtZGFyayIgbGV0dGVyLXNwYWNpbmc9IjMiPlNBR0FSIEVOVEVSUFJJU0VTPC90ZXh0PgogICAgCiAgICA8dGV4dCB4PSIxMDAiIHk9IjIyMCIgZm9udC1zaXplPSIyMiIgZm9udC13ZWlnaHQ9IjgwMCIgY2xhc3M9InRleHQtZGFyayI+VURZQU0gVVAgMDQtMDAzMDEyNzwvdGV4dD4KICAgIDx0ZXh0IHg9IjEwMCIgeT0iMjUwIiBmb250LXNpemU9IjIyIiBmb250LXdlaWdodD0iODAwIiBjbGFzcz0idGV4dC1kYXJrIj5TQUdBUiBFTlRFUlBSSVNFUzwvdGV4dD4KCiAgICA8dGV4dCB4PSIzODAiIHk9IjIyMCIgZm9udC1zaXplPSIyMiIgZm9udC13ZWlnaHQ9IjgwMCIgY2xhc3M9InRleHQtZGFyayI+TElDLiBOby4gMTI3MTkwMjUwMDAxODA8L3RleHQ+CiAgICA8dGV4dCB4PSIzODAiIHk9IjI1MCIgZm9udC1zaXplPSIyMiIgZm9udC13ZWlnaHQ9IjgwMCIgY2xhc3M9InRleHQtZGFyayI+U0FHQVIgRU5URVJQUklTRVM8L3RleHQ+CiAgPC9nPgoKCiAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNzgwLCA4MCkiPgogICAgPHRleHQgeD0iMCIgeT0iMCIgY2xhc3M9ImZvbnQtaW1wYWN0IGJyYW5kLWJsdWUiIGZvbnQtc2l6ZT0iNzAiIGZvbnQtd2VpZ2h0PSI5MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGxldHRlci1zcGFjaW5nPSIyIiBtYXNrPSJ1cmwoI21zbWUtbWFzaykiPk1TTUU8L3RleHQ+CiAgICAKICAgIDx0ZXh0IHg9IjAiIHk9IjIwIiBjbGFzcz0iZm9udC1zYW5zIGJyYW5kLWJsdWUiIGZvbnQtc2l6ZT0iMTAuNSIgZm9udC13ZWlnaHQ9IjgwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+TUlDUk8sIFNNQUxMICZhbXA7IE1FRElVTSBFTlRFUlBSSVNFUzwvdGV4dD4KICAgIDx0ZXh0IHg9IjAiIHk9IjM0IiBjbGFzcz0iZm9udC1zYW5zIGJyYW5kLWJsdWUiIGZvbnQtc2l6ZT0iMTAiIGZvbnQtd2VpZ2h0PSI2MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiPuCkuOClguCkleCljeCkt+CljeCkriwg4KSy4KSY4KWBIOCkj+CkteCkgiDgpK7gpKfgpY3gpK/gpK4g4KSJ4KSm4KWN4KSv4KSuPC90ZXh0PgogICAgPHRleHQgeD0iMCIgeT0iNDgiIGNsYXNzPSJmb250LXNhbnMgYnJhbmQtYmx1ZSIgZm9udC1zaXplPSI3LjUiIGZvbnQtd2VpZ2h0PSI4MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGxldHRlci1zcGFjaW5nPSIwLjUiPk9VUiBTVFJFTkdUSCDigKIg4KS54KSu4KS+4KSw4KWAIOCktuCkleCljeCkpOCkvzwvdGV4dD4KICAgIAogICAgPHRleHQgeD0iMCIgeT0iODAiIGNsYXNzPSJmb250LXNhbnMgdGV4dC1kYXJrIiBmb250LXNpemU9IjE2IiBmb250LXdlaWdodD0iODAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5VRFlBTSBVUCAwNC0wMDMwMTI3PC90ZXh0PgogICAgPHRleHQgeD0iMCIgeT0iMTAwIiBjbGFzcz0iZm9udC1zYW5zIHRleHQtZGFyayIgZm9udC1zaXplPSIxNiIgZm9udC13ZWlnaHQ9IjgwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+U0FHQVIgRU5URVJQUklTRVM8L3RleHQ+CiAgPC9nPgoKICA8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxMDIwLCA4MCkiPgogICAgPHRleHQgeD0iLTUiIHk9IjAiIGNsYXNzPSJmb250LXNlcmlmIGJyYW5kLWJsdWUiIGZvbnQtc2l6ZT0iNzAiIGZvbnQtd2VpZ2h0PSJib2xkIiBmb250LXN0eWxlPSJpdGFsaWMiIHRleHQtYW5jaG9yPSJtaWRkbGUiPmZzc2FpPC90ZXh0PgogICAgCiAgICA8cGF0aCBkPSJNIC01MCA4IFEgLTUgMzggNDUgOCBRIC01IDIyIC01MCA4IFoiIGNsYXNzPSJicmFuZC1vcmFuZ2UiIC8+CiAgICAKICAgIDxjaXJjbGUgY3g9IjQ1IiBjeT0iLTQyIiByPSI2IiBjbGFzcz0iYnJhbmQtb3JhbmdlIiAvPgogICAgPHBhdGggZD0iTSA0NSAtNTIgQyA1MCAtNzIsIDcwIC02MiwgNTUgLTQyIFoiIGNsYXNzPSJicmFuZC1ncmVlbiIgLz4KICAgIAogICAgPHRleHQgeD0iMCIgeT0iODAiIGNsYXNzPSJmb250LXNhbnMgdGV4dC1kYXJrIiBmb250LXNpemU9IjE2IiBmb250LXdlaWdodD0iODAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5MSUMuIE5vLiAxMjcxOTAyNTAwMDE4MDwvdGV4dD4KICAgIDx0ZXh0IHg9IjAiIHk9IjEwMCIgY2xhc3M9ImZvbnQtc2FucyB0ZXh0LWRhcmsiIGZvbnQtc2l6ZT0iMTYiIGZvbnQtd2VpZ2h0PSI4MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiPlNBR0FSIEVOVEVSUFJJU0VTPC90ZXh0PgogIDwvZz4KCgogIDxyZWN0IHg9IjY1MCIgeT0iMjA1IiB3aWR0aD0iNTAwIiBoZWlnaHQ9IjExNSIgZmlsbD0iI2Y0ZjRmNCIgcng9IjQiIC8+CgogIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDY3MCwgMjIwKSI+CiAgICA8cmVjdCB4PSIwIiB5PSIwIiB3aWR0aD0iMTMwIiBoZWlnaHQ9IjgwIiBmaWxsPSJ1cmwoI2luZGlhR3JhZCkiIHN0cm9rZT0iIzY2NiIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICAgIAogICAgPHBhdGggZD0iTSAyNSA1MCBMIDMwIDM1IEwgNDUgMzUgUSA1MCAyMCA2NSAyNSBMIDc1IDMwIEwgOTAgNDAgUSAxMDAgMzAgMTA1IDQ1IFEgMTAwIDQ1IDk1IDQyIEwgODUgNjUgTCA3NSA2NSBMIDc1IDUwIEwgNjUgNTAgTCA2NSA2NSBMIDU1IDY1IEwgNTUgNTAgTCA0MCA1MCBMIDQwIDY1IEwgMzAgNjUgTCAzMCA1MCBaIiBjbGFzcz0idGV4dC1kYXJrIiAvPgogICAgCiAgICA8dGV4dCB4PSI2NSIgeT0iNzUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMSIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiNmZmZmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGxldHRlci1zcGFjaW5nPSIxIj5NQUtFIElOIElORElBPC90ZXh0PgogIDwvZz4KCiAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoODUwLCAyMjUpIj4KICAgIDxjaXJjbGUgY3g9IjIwIiBjeT0iMTUiIHI9IjgiIGNsYXNzPSJ0ZXh0LWRhcmsiIC8+CiAgICA8cGF0aCBkPSJNIDIwIDI1IEwgMjAgNTAgTSAyMCA1MCBMIDEwIDc1IE0gMjAgNTAgTCAzMCA3NSBNIDUgMzUgTCAyMCAzNSBMIDM1IDQ1IiBzdHJva2U9IiMyMzFmMjAiIHN0cm9rZS13aWR0aD0iNSIgZmlsbD0ibm9uZSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CiAgICAKICAgIDxwb2x5Z29uIHBvaW50cz0iNTAsNDUgNzUsNDUgNzAsODAgNTUsODAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzIzMWYyMCIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CiAgICA8bGluZSB4MT0iNDUiIHkxPSI0NSIgeDI9IjgwIiB5Mj0iNDUiIHN0cm9rZT0iIzIzMWYyMCIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICAgIAogICAgPGNpcmNsZSBjeD0iNDIiIGN5PSIzMCIgcj0iMyIgY2xhc3M9InRleHQtZGFyayIvPgogICAgPGNpcmNsZSBjeD0iNDgiIGN5PSIzOCIgcj0iMyIgY2xhc3M9InRleHQtZGFyayIvPgogIDwvZz4KCiAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoOTgwLCAyMjUpIj4KICAgIDxjaXJjbGUgY3g9IjQwIiBjeT0iMzAiIHI9IjIyIiBmaWxsPSJub25lIiBzdHJva2U9IiMyMzFmMjAiIHN0cm9rZS13aWR0aD0iMyIvPgogICAgPGNpcmNsZSBjeD0iMTAwIiBjeT0iMzAiIHI9IjIyIiBmaWxsPSJub25lIiBzdHJva2U9IiMyMzFmMjAiIHN0cm9rZS13aWR0aD0iMyIvPgogICAgCiAgICA8cGF0aCBkPSJNIDYyIDMwIFEgNzAgMjAgNzggMzAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzIzMWYyMCIgc3Ryb2tlLXdpZHRoPSIzIi8+CiAgICAKICAgIDxwYXRoIGQ9Ik0gMTggMzAgUSA1IDIwIDAgMzUiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzIzMWYyMCIgc3Ryb2tlLXdpZHRoPSIzIi8+CiAgICA8cGF0aCBkPSJNIDEyMiAzMCBRIDEzNSAyMCAxNDAgMzUiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzIzMWYyMCIgc3Ryb2tlLXdpZHRoPSIzIi8+CiAgICAKICAgIDx0ZXh0IHg9IjQwIiB5PSIzNSIgY2xhc3M9ImZvbnQtc2FucyB0ZXh0LWRhcmsiIGZvbnQtc2l6ZT0iMTIiIGZvbnQtd2VpZ2h0PSJib2xkIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7gpLjgpY3gpLXgpJrgpY3gpJs8L3RleHQ+CiAgICA8dGV4dCB4PSIxMDAiIHk9IjM1IiBjbGFzcz0iZm9udC1zYW5zIHRleHQtZGFyayIgZm9udC1zaXplPSIxMiIgZm9udC13ZWlnaHQ9ImJvbGQiIHRleHQtYW5jaG9yPSJtaWRkbGUiPuCkreCkvuCksOCkpDwvdGV4dD4KICAgIAogICAgPHRleHQgeD0iNzAiIHk9IjcwIiBjbGFzcz0iZm9udC1zYW5zIHRleHQtZGFyayIgZm9udC1zaXplPSIxMSIgZm9udC13ZWlnaHQ9ImJvbGQiIHRleHQtYW5jaG9yPSJtaWRkbGUiPuCkj+CklSDgpJXgpKbgpK4g4KS44KWN4KS14KSa4KWN4KSb4KSk4KS+IOCkleClgCDgpJPgpLA8L3RleHQ+CiAgPC9nPgoKPC9zdmc+';

  let invoiceData = defaultInvoiceData();
  let letterheadData = defaultLetterheadData();

  function defaultInvoiceData() {
    return {
      invoiceNumber: '#0010',
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      billTo: { name: '', nameAr: '', person: '', personAr: '', area: '', areaAr: '', phone: '' },
      shareContact: { email: '', whatsapp: '' },
      pages: [{ items: [] }],
      notes: '',
      discount: 0,
      amountWordsText: '',
      totalsOverride: {
        subtotal: '',
        previousPagesTotal: '',
        totalPayable: ''
      }
    };
  }

  function defaultLetterheadData() {
    return {
      date: '',
      to: '',
      toAr: '',
      area: '',
      areaAr: '',
      subject: 'OPENING FILE & ENTERING ITEMS',
      subjectAr: 'فتح ملف و إدخال أصناف',
      shareContact: { email: '', whatsapp: '' },
      pages: [{ items: [] }],
      notes: ''
    };
  }

  function blankInvoicePageMeta() {
    return {
      invoiceNumber: '',
      date: '',
      billTo: { name: '', nameAr: '', person: '', personAr: '', area: '', areaAr: '', phone: '' }
    };
  }

  function blankLetterheadPageMeta() {
    return {
      date: '',
      to: '',
      toAr: '',
      area: '',
      areaAr: '',
      subject: '',
      subjectAr: ''
    };
  }

  function createBlankPage(viewType) {
    return {
      items: [],
      meta: viewType === 'invoice' ? blankInvoicePageMeta() : blankLetterheadPageMeta()
    };
  }

  function createCopiedContactMeta(viewType, data) {
    if (viewType === 'invoice') {
      return {
        ...blankInvoicePageMeta(),
        billTo: {
          ...blankInvoicePageMeta().billTo,
          ...(data?.billTo || {})
        }
      };
    }

    return {
      ...blankLetterheadPageMeta(),
      to: data?.to || '',
      toAr: data?.toAr || '',
      area: data?.area || '',
      areaAr: data?.areaAr || ''
    };
  }

  function createPageWithCopiedContactInfo(viewType, data) {
    return {
      items: [],
      meta: createCopiedContactMeta(viewType, data)
    };
  }

  function hasPageMeta(page) {
    return !!(page && page.meta && typeof page.meta === 'object');
  }

  function normalizePageMeta(viewType, page) {
    if (!hasPageMeta(page)) return undefined;

    if (viewType === 'invoice') {
      return {
        ...blankInvoicePageMeta(),
        ...page.meta,
        billTo: {
          ...blankInvoicePageMeta().billTo,
          ...(page.meta.billTo || {})
        }
      };
    }

    return {
      ...blankLetterheadPageMeta(),
      ...page.meta
    };
  }

  function normalizeStoredPages(pages, viewType) {
    const sourcePages = Array.isArray(pages) && pages.length > 0 ? pages : [{ items: [] }];
    return sourcePages.map((page) => ({
      ...page,
      items: Array.isArray(page?.items) ? page.items : [],
      ...(hasPageMeta(page) ? { meta: normalizePageMeta(viewType, page) } : {})
    }));
  }

  function resolveInvoicePageData(data, page) {
    if (!hasPageMeta(page)) return data;

    return {
      ...data,
      invoiceNumber: page.meta.invoiceNumber || '',
      date: page.meta.date || '',
      billTo: {
        ...blankInvoicePageMeta().billTo,
        ...(page.meta.billTo || {})
      }
    };
  }

  function resolveLetterheadPageData(data, page) {
    if (!hasPageMeta(page)) return data;

    return {
      ...data,
      ...blankLetterheadPageMeta(),
      ...page.meta
    };
  }

  function buildFieldBindingAttrs(pageIndex, page) {
    return hasPageMeta(page)
      ? ` data-page-scope="page" data-page-index="${pageIndex}"`
      : ' data-page-scope="document"';
  }

  function findInvoiceTotalsPageIndex(pages) {
    for (let index = pages.length - 1; index >= 0; index -= 1) {
      if ((pages[index]?.items || []).length > 0) {
        return index;
      }
    }
    return Math.max(0, pages.length - 1);
  }

  function getItemQty(item) {
    return parseInt(item?.qty, 10) || 0;
  }

  function getItemUnitPriceFils(item) {
    const directFils = item?.unit_price_fils;
    if (typeof directFils === 'number' && Number.isFinite(directFils)) {
      return Math.round(directFils);
    }
    if (typeof directFils === 'string' && /^[0-9]+$/.test(directFils.trim())) {
      return parseInt(directFils.trim(), 10) || 0;
    }

    const source = item?.unit_price ?? item?.unitPrice ?? 0;
    return typeof source === 'number'
      ? Math.round(source)
      : InvoiceMath.parseFils(source);
  }

  function getItemTotalFils(item) {
    const explicitTotal = Number(item?.total_fils);
    if (item?.total_manual_override) {
      return Number.isFinite(explicitTotal) ? Math.max(0, Math.round(explicitTotal)) : 0;
    }
    if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
      return Math.round(explicitTotal);
    }
    return InvoiceMath.rowTotal(getItemQty(item), getItemUnitPriceFils(item));
  }

  function getDiscountFils(data) {
    return InvoiceMath.parseFils(data?.discount);
  }

  function normalizeTotalsOverride(value = {}) {
    return {
      ...defaultInvoiceData().totalsOverride,
      ...(value || {})
    };
  }

  function resolveTotalsDisplayValue(overrideText, autoText) {
    const override = String(overrideText || '').trim();
    return override || autoText || '';
  }

  function hasVisibleUnitPrice(item) {
    return getItemUnitPriceFils(item) !== 0;
  }

  function hasVisibleLineTotal(item) {
    if (item?.total_manual_override) {
      return true;
    }
    return getItemQty(item) !== 0 && hasVisibleUnitPrice(item);
  }

  function pageHasFinancialData(items) {
    return (items || []).some((item) => hasVisibleLineTotal(item));
  }

  function formatUnitPriceCell(item) {
    return hasVisibleUnitPrice(item)
      ? `${InvoiceMath.filsToKD(getItemUnitPriceFils(item))} FILS`
      : '';
  }

  function formatRowTotalCell(item, totalFils) {
    if (item?.total_manual_override) {
      return `${InvoiceMath.filsToKD(totalFils)} KD.`;
    }
    return hasVisibleLineTotal(item)
      ? `${InvoiceMath.filsToKD(totalFils)} KD.`
      : '';
  }

  function getTableSerialOffset(allPages, pageIndex) {
    let serialOffset = 0;
    for (let index = 0; index < pageIndex; index += 1) {
      serialOffset += (allPages[index].items || []).length;
    }
    return serialOffset;
  }

  function renderDocumentTableHead() {
    return `<thead><tr>
        <th class="col-sno"><div class="th-bi">S.<br>no.</div></th>
        <th class="col-barcode"><div class="th-bi">الباركود<br>Barcode</div></th>
        <th class="col-product-by"><div class="th-bi">المنشأة<br>Product By</div></th>
        <th class="col-name-en"><div class="th-bi">Item Name</div></th>
        <th class="col-name-ar"><div class="th-bi">اسم الصنف</div></th>
        <th class="col-weight"><div class="th-bi">الوزن<br>Weight</div></th>
        <th class="col-qty"><div class="th-bi">العدد<br>Qty.</div></th>
        <th class="col-unit-price"><div class="th-bi">السعر الوحدة<br>Unit Price</div></th>
        <th class="col-price"><div class="th-bi">السعر<br>Price</div></th>
      </tr></thead>`;
  }

  function renderDocumentItemRow(item, index, serial) {
    const totalFils = getItemTotalFils(item);

    return {
      totalFils,
      html: `<tr data-index="${index}">
          <td class="col-sno">${serial}</td>
          <td contenteditable="true" data-field="barcode">${esc(item.barcode)}</td>
          <td contenteditable="true" data-field="product_by">${esc(item.product_by || '')}</td>
          <td contenteditable="true" data-field="name_en">${esc(item.name_en)}</td>
          <td contenteditable="true" data-field="name_ar" dir="rtl">${esc(item.name_ar)}</td>
          <td contenteditable="true" data-field="weight">${esc(item.weight)}</td>
          <td contenteditable="true" data-field="qty">${esc(String(item.qty || ''))}</td>
          <td contenteditable="true" data-field="unit_price">${formatUnitPriceCell(item)}</td>
          <td contenteditable="true" data-field="total" data-manual-override="${item.total_manual_override ? 'true' : 'false'}">${formatRowTotalCell(item, totalFils)}</td>
        </tr>`
    };
  }

  function renderDocumentBlankRow(serial) {
    return `<tr>
        <td class="col-sno">${serial}</td>
        <td contenteditable="true" data-field="barcode"></td>
        <td contenteditable="true" data-field="product_by"></td>
        <td contenteditable="true" data-field="name_en"></td>
        <td contenteditable="true" data-field="name_ar" dir="rtl"></td>
        <td contenteditable="true" data-field="weight"></td>
        <td contenteditable="true" data-field="qty"></td>
        <td contenteditable="true" data-field="unit_price"></td>
        <td contenteditable="true" data-field="total" data-manual-override="false"></td>
      </tr>`;
  }

  function legacyRenderInvoice() {
    const data = invoiceData;
    const allPages = normalizePages(data.pages, ITEMS_PER_PAGE_INVOICE);
    data.pages = allPages;
    const totalsPageIndex = findInvoiceTotalsPageIndex(allPages);
    const totalPages = allPages.length;

    let html = '<div class="invoice-pages-wrapper">';

    for (let pi = 0; pi < totalPages; pi += 1) {
      const page = allPages[pi];
      const items = page.items || [];
      const pageNum = pi + 1;
      const isFinalTotalsPage = pi === totalsPageIndex;
      const hasPageAmounts = pageHasFinancialData(items);
      const pageViewData = resolveInvoicePageData(data, page);

      html += `<div class="inv-page inv-page-portrait" data-page="${pageNum}">`;
      html += `<span class="inv-page-label">Page ${pageNum}</span>`;
      html += renderInvoiceHeader(pageViewData, pi, page);

      html += '<div class="inv-table-wrap"><table class="inv-table inv-table-portrait">';
      html += `<thead><tr>
        <th class="col-sno"><div class="th-bi">S.<br>no.</div></th>
        <th class="col-barcode"><div class="th-bi">الباركود<br>Barcode</div></th>
        <th class="col-product-by"><div class="th-bi">المنشأة<br>Product By</div></th>
        <th class="col-name-en"><div class="th-bi">Item Name</div></th>
        <th class="col-name-ar"><div class="th-bi">اسم الصنف</div></th>
        <th class="col-weight"><div class="th-bi">الوزن<br>Weight</div></th>
        <th class="col-qty"><div class="th-bi">العدد<br>Qty.</div></th>
        <th class="col-unit-price"><div class="th-bi">السعر الوحدة<br>Unit Price</div></th>
        <th class="col-price"><div class="th-bi">السعر<br>Price</div></th>
      </tr></thead><tbody>`;

      let serialOffset = 0;
      for (let p = 0; p < pi; p += 1) {
        serialOffset += (allPages[p].items || []).length;
      }

      let pageSubtotalFils = 0;
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const totalFils = getItemTotalFils(item);
        pageSubtotalFils += totalFils;
        const sno = serialOffset + index + 1;

        html += `<tr data-index="${index}">
          <td class="col-sno">${sno}</td>
          <td contenteditable="true" data-field="barcode">${esc(item.barcode)}</td>
          <td contenteditable="true" data-field="product_by">${esc(item.product_by || '')}</td>
          <td contenteditable="true" data-field="name_en">${esc(item.name_en)}</td>
          <td contenteditable="true" data-field="name_ar" dir="rtl">${esc(item.name_ar)}</td>
          <td contenteditable="true" data-field="weight">${esc(item.weight)}</td>
          <td contenteditable="true" data-field="qty">${esc(String(item.qty || ''))}</td>
          <td contenteditable="true" data-field="unit_price">${formatUnitPriceCell(item)}</td>
          <td data-field="total">${formatRowTotalCell(item, totalFils)}</td>
        </tr>`;
      }

      for (let index = items.length; index < ITEMS_PER_PAGE_INVOICE; index += 1) {
        const sno = serialOffset + index + 1;
        html += `<tr>
          <td class="col-sno">${sno}</td>
          <td contenteditable="true" data-field="barcode"></td>
          <td contenteditable="true" data-field="product_by"></td>
          <td contenteditable="true" data-field="name_en"></td>
          <td contenteditable="true" data-field="name_ar" dir="rtl"></td>
          <td contenteditable="true" data-field="weight"></td>
          <td contenteditable="true" data-field="qty"></td>
          <td contenteditable="true" data-field="unit_price"></td>
          <td></td>
        </tr>`;
      }

      html += `<tr class="inv-subtotal-row">
        <td colspan="8" class="inv-subtotal-label"><strong>Subtotal</strong></td>
        <td class="inv-subtotal-value" data-field="page-subtotal"><strong>${hasPageAmounts ? `${InvoiceMath.filsToKD(pageSubtotalFils)} KD.` : ''}</strong></td>
      </tr>`;

      html += '</tbody></table></div>';

      if (isFinalTotalsPage) {
        let previousPagesTotal = 0;
        for (let p = 0; p < pi; p += 1) {
          previousPagesTotal += InvoiceMath.subtotal(allPages[p].items || []);
        }

        const grandTotalFils = previousPagesTotal + pageSubtotalFils;
        const discountFils = getDiscountFils(data);
        const payableFils = grandTotalFils - discountFils;
        const hasAnyAmounts = allPages.some((pageEntry) => pageHasFinancialData(pageEntry.items || []));
        const words = hasAnyAmounts ? InvoiceMath.amountInWords(payableFils > 0 ? payableFils : 0) : '';

        html += `
        <div class="inv-bottom-section">
          <div class="inv-amount-words">
            <div class="inv-aw-title"><strong>TOTAL AMOUNT IN WORD</strong></div>
            <div class="inv-aw-text" contenteditable="true">${esc(words)}</div>
          </div>
          <div class="inv-totals-box">
            <table class="inv-totals-table">
              <tr><td class="inv-tot-label">Subtotal</td><td class="inv-tot-value">${hasPageAmounts ? `${InvoiceMath.filsToKD(pageSubtotalFils)} KD.` : ''}</td></tr>
              ${pi > 0 ? `<tr><td class="inv-tot-label">Prev. Pages Total</td><td class="inv-tot-value">${hasAnyAmounts ? `${InvoiceMath.filsToKD(previousPagesTotal)} KD.` : ''}</td></tr>` : ''}
              ${discountFils > 0 ? `<tr><td class="inv-tot-label">Discount</td><td class="inv-tot-value">${hasAnyAmounts ? `${InvoiceMath.filsToKD(discountFils)} KD.` : ''}</td></tr>` : ''}
              <tr class="inv-tot-grand"><td class="inv-tot-label"><strong>Total Payable Amount</strong></td><td class="inv-tot-value"><strong>${hasAnyAmounts ? `${InvoiceMath.filsToKD(payableFils)} KD.` : ''}</strong></td></tr>
            </table>
          </div>
        </div>`;
      }

      html += renderInvoiceFooter(pageNum);
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderInvoiceHeader(data, pageIndex, page) {
    const bindAttrs = buildFieldBindingAttrs(pageIndex, page);

    return `
      <div class="inv-header-svg-wrap">
        <img src="assets/invoice-header-top.svg" alt="Invoice header - Al Ghanim" class="inv-header-layout-svg" />
      </div>
      <div class="inv-title-bar">
        <span class="inv-title-label">Invoice:</span>
        <span contenteditable="true" data-field="invoiceNumber"${bindAttrs}>${esc(data.invoiceNumber)}</span>
        <span class="inv-title-separator">/</span>
        <span contenteditable="true" data-field="date"${bindAttrs}>${esc(data.date)}</span>
      </div>
      <div class="inv-bill-section">
        <div class="inv-bill-left">
          <div class="inv-bill-row"><strong>Bill To: </strong><span contenteditable="true" data-field="billTo.name"${bindAttrs}>${esc(data.billTo.name || '')}</span></div>
          <div class="inv-bill-row"><span contenteditable="true" data-field="billTo.person"${bindAttrs}>${esc(data.billTo.person || '')}</span></div>
          <div class="inv-bill-row"><span contenteditable="true" data-field="billTo.area"${bindAttrs}>${esc(data.billTo.area || '')}</span></div>
          <div class="inv-bill-row">Cont. No. : <span contenteditable="true" data-field="billTo.phone"${bindAttrs}>${esc(data.billTo.phone || '')}</span></div>
        </div>
        <div class="inv-bill-right">
          <div class="inv-bill-row-ar" dir="rtl">فاتورة الى: <span contenteditable="true" data-field="billTo.nameAr"${bindAttrs}>${esc(data.billTo.nameAr || '')}</span></div>
          <div class="inv-bill-row-ar" contenteditable="true" data-field="billTo.personAr" dir="rtl"${bindAttrs}>${esc(data.billTo.personAr || '')}</div>
          <div class="inv-bill-row-ar" contenteditable="true" data-field="billTo.areaAr" dir="rtl"${bindAttrs}>${esc(data.billTo.areaAr || '')}</div>
          <div class="inv-bill-row-ar" dir="rtl">رقم الاتصال: <span contenteditable="true" data-field="billTo.phone"${bindAttrs}>${esc(data.billTo.phone || '')}</span></div>
        </div>
      </div>`;
  }

  function renderInvoiceFooter(pageNum) {
    return `
      <div class="inv-footer-section">
        <div class="inv-footer-sagar">
          <img src="${INVOICE_FOOTER_LOGO_SRC}" alt="Invoice footer logo" class="inv-footer-logo" />
        </div>
        <div class="inv-footer-sigs">
          <div class="inv-sig-box">
            <div class="inv-sig-label-en">Receiver's Sig.</div>
            <div class="inv-sig-label-ar">توقيع المستلم</div>
            <div class="inv-sig-line"></div>
          </div>
          <div class="inv-sig-box">
            <div class="inv-sig-label-en">Salesman Sig.</div>
            <div class="inv-sig-label-ar">توقيع البائع</div>
            <div class="inv-sig-line"></div>
          </div>
        </div>
      </div>
      <div class="inv-page-number">Page No. ${String(pageNum).padStart(2, '0')}</div>`;
  }

  function legacyRenderLetterhead() {
    const data = letterheadData;
    const allPages = normalizePages(data.pages, ITEMS_PER_PAGE_LETTERHEAD);
    data.pages = allPages;
    const totalPages = allPages.length;
    let html = '<div class="invoice-pages-wrapper">';

    for (let pi = 0; pi < totalPages; pi += 1) {
      const page = allPages[pi];
      const items = page.items || [];
      const pageNum = pi + 1;
      const pageViewData = resolveLetterheadPageData(data, page);

      html += `<div class="inv-page inv-page-landscape" data-page="${pageNum}">`;
      html += `<span class="inv-page-label">Page ${pageNum}</span>`;
      html += renderLetterheadHeader(pageViewData, pi, page);
      html += renderLetterheadTable(items);
      html += renderLetterheadFooter();
      html += '</div>';
      continue;

      html += '<div class="inv-table-wrap"><table class="inv-table lh-table">';
      html += `<thead><tr>
        <th class="col-barcode"><div class="th-bi">الباركود<br>Barcode</div></th>
        <th class="col-product-by"><div class="th-bi">المنشأة<br>Product By</div></th>
        <th class="col-price"><div class="th-bi">السعر<br>Price</div></th>
        <th class="col-unit-price"><div class="th-bi">السعر الوحدة<br>Unit Price</div></th>
        <th class="col-qty"><div class="th-bi">العدد<br>Qty.</div></th>
        <th class="col-weight"><div class="th-bi">الوزن<br>Weight</div></th>
        <th class="col-name-en"><div class="th-bi">Name</div></th>
        <th class="col-name-ar"><div class="th-bi">اسم الصنف</div></th>
        <th class="col-sno"><div class="th-bi">S. no.</div></th>
      </tr></thead><tbody>`;

      let serialOffset = 0;
      for (let p = 0; p < pi; p += 1) {
        serialOffset += (allPages[p].items || []).length;
      }

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const totalFils = getItemTotalFils(item);
        const sno = serialOffset + index + 1;

        html += `<tr data-index="${index}">
          <td contenteditable="true" data-field="barcode">${esc(item.barcode)}</td>
          <td contenteditable="true" data-field="product_by">${esc(item.product_by || '')}</td>
          <td data-field="total">${formatRowTotalCell(item, totalFils)}</td>
          <td contenteditable="true" data-field="unit_price">${formatUnitPriceCell(item)}</td>
          <td contenteditable="true" data-field="qty">${esc(String(item.qty || ''))}</td>
          <td contenteditable="true" data-field="weight">${esc(item.weight)}</td>
          <td contenteditable="true" data-field="name_en">${esc(item.name_en)}</td>
          <td contenteditable="true" data-field="name_ar" dir="rtl">${esc(item.name_ar)}</td>
          <td class="col-sno">${String(sno).padStart(2, '0')}</td>
        </tr>`;
      }

      for (let index = items.length; index < ITEMS_PER_PAGE_LETTERHEAD; index += 1) {
        const sno = serialOffset + index + 1;
        html += `<tr>
          <td contenteditable="true" data-field="barcode"></td>
          <td contenteditable="true" data-field="product_by"></td>
          <td></td>
          <td contenteditable="true" data-field="unit_price"></td>
          <td contenteditable="true" data-field="qty"></td>
          <td contenteditable="true" data-field="weight"></td>
          <td contenteditable="true" data-field="name_en"></td>
          <td contenteditable="true" data-field="name_ar" dir="rtl"></td>
          <td class="col-sno">${String(sno).padStart(2, '0')}</td>
        </tr>`;
      }

      html += '</tbody></table></div>';
      html += `
      <div class="lh-footer">
        <div class="lh-footer-left">
          <div>مقدم الطلب :</div>
          <div>التوقيع :</div>
        </div>
        <div class="lh-footer-right">
          <div>شاكرين و مقدرين حسن تعاونكم،</div>
          <div>وتفضلوا بقبول فائق الاحترام والتقدير.</div>
        </div>
      </div>`;
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function legacyRenderLetterheadTable(items) {
    let html = '<div class="inv-table-wrap"><table class="inv-table lh-table">';
    html += `<thead><tr>
      <th class="col-barcode"><div class="th-bi">Barcode</div></th>
      <th class="col-product-by"><div class="th-bi">Product By</div></th>
      <th class="col-name-en"><div class="th-bi">Item Name</div></th>
      <th class="col-name-ar"><div class="th-bi">Name (AR)</div></th>
      <th class="col-weight"><div class="th-bi">Weight</div></th>
      <th class="col-qty"><div class="th-bi">Qty.</div></th>
      <th class="col-unit-price"><div class="th-bi">Unit Price</div></th>
      <th class="col-price"><div class="th-bi">Price</div></th>
    </tr></thead><tbody>`;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const totalFils = getItemTotalFils(item);

      html += `<tr data-index="${index}">
        <td contenteditable="true" data-field="barcode">${esc(item.barcode)}</td>
        <td contenteditable="true" data-field="product_by">${esc(item.product_by || '')}</td>
        <td contenteditable="true" data-field="name_en">${esc(item.name_en)}</td>
        <td contenteditable="true" data-field="name_ar" dir="rtl">${esc(item.name_ar)}</td>
        <td contenteditable="true" data-field="weight">${esc(item.weight)}</td>
        <td contenteditable="true" data-field="qty">${esc(String(item.qty || ''))}</td>
        <td contenteditable="true" data-field="unit_price">${formatUnitPriceCell(item)}</td>
        <td data-field="total">${formatRowTotalCell(item, totalFils)}</td>
      </tr>`;
    }

    for (let index = items.length; index < ITEMS_PER_PAGE_LETTERHEAD; index += 1) {
      html += `<tr>
        <td contenteditable="true" data-field="barcode"></td>
        <td contenteditable="true" data-field="product_by"></td>
        <td contenteditable="true" data-field="name_en"></td>
        <td contenteditable="true" data-field="name_ar" dir="rtl"></td>
        <td contenteditable="true" data-field="weight"></td>
        <td contenteditable="true" data-field="qty"></td>
        <td contenteditable="true" data-field="unit_price"></td>
        <td></td>
      </tr>`;
    }

    html += '</tbody></table></div>';
    return html;
  }

  function renderInvoice() {
    const data = invoiceData;
    const allPages = normalizePages(data.pages, ITEMS_PER_PAGE_INVOICE);
    data.pages = allPages;
    const totalsPageIndex = findInvoiceTotalsPageIndex(allPages);
    const totalPages = allPages.length;
    const totalsOverride = normalizeTotalsOverride(data.totalsOverride);

    let html = '<div class="invoice-pages-wrapper">';

    for (let pi = 0; pi < totalPages; pi += 1) {
      const page = allPages[pi];
      const items = page.items || [];
      const pageNum = pi + 1;
      const isFinalTotalsPage = pi === totalsPageIndex;
      const hasPageAmounts = pageHasFinancialData(items);
      const pageViewData = resolveInvoicePageData(data, page);
      html += `<div class="inv-page inv-page-portrait" data-page="${pageNum}">`;
      html += `<span class="inv-page-label">Page ${pageNum}</span>`;
      html += renderInvoiceHeader(pageViewData, pi, page);

      html += '<div class="inv-table-wrap"><table class="inv-table inv-table-portrait">';
      html += renderDocumentTableHead();
      html += '<tbody>';

      let pageSubtotalFils = 0;
      for (let index = 0; index < items.length; index += 1) {
        const row = renderDocumentItemRow(items[index], index, index + 1);
        pageSubtotalFils += row.totalFils;
        html += row.html;
      }

      for (let index = items.length; index < ITEMS_PER_PAGE_INVOICE; index += 1) {
        html += renderDocumentBlankRow(index + 1);
      }

      html += `<tr class="inv-subtotal-row">
        <td colspan="8" class="inv-subtotal-label"><strong>Subtotal</strong></td>
        <td class="inv-subtotal-value" data-field="page-subtotal"><strong>${hasPageAmounts ? `${InvoiceMath.filsToKD(pageSubtotalFils)} KD.` : ''}</strong></td>
      </tr>`;

      html += '</tbody></table></div>';

      if (isFinalTotalsPage) {
        let previousPagesTotal = 0;
        for (let p = 0; p < pi; p += 1) {
          previousPagesTotal += InvoiceMath.subtotal(allPages[p].items || []);
        }

        const grandTotalFils = previousPagesTotal + pageSubtotalFils;
        const discountFils = getDiscountFils(data);
        const payableFils = grandTotalFils - discountFils;
        const hasAnyAmounts = allPages.some((pageEntry) => pageHasFinancialData(pageEntry.items || []));
        const amountWordsOverride = String(data.amountWordsText || '').trim();
        const words = amountWordsOverride
          || (hasAnyAmounts ? InvoiceMath.amountInWords(payableFils > 0 ? payableFils : 0) : '');
        const subtotalText = resolveTotalsDisplayValue(
          totalsOverride.subtotal,
          hasPageAmounts ? `${InvoiceMath.filsToKD(pageSubtotalFils)} KD.` : ''
        );
        const previousPagesText = resolveTotalsDisplayValue(
          totalsOverride.previousPagesTotal,
          hasAnyAmounts ? `${InvoiceMath.filsToKD(previousPagesTotal)} KD.` : ''
        );
        const totalPayableText = resolveTotalsDisplayValue(
          totalsOverride.totalPayable,
          hasAnyAmounts ? `${InvoiceMath.filsToKD(payableFils)} KD.` : ''
        );

        html += `
        <div class="inv-bottom-section">
          <div class="inv-amount-words">
            <div class="inv-aw-title"><strong>TOTAL AMOUNT IN WORD</strong></div>
            <div class="inv-aw-text" contenteditable="true" data-field="amountWordsText" data-manual-override="${amountWordsOverride ? 'true' : 'false'}">${esc(words)}</div>
          </div>
          <div class="inv-totals-box">
            <table class="inv-totals-table">
              <tr><td class="inv-tot-label">Subtotal</td><td class="inv-tot-value" contenteditable="true" data-field="totalsOverride.subtotal" data-manual-override="${totalsOverride.subtotal ? 'true' : 'false'}">${esc(subtotalText)}</td></tr>
              ${pi > 0 || previousPagesText ? `<tr><td class="inv-tot-label">Prev. Pages Total</td><td class="inv-tot-value" contenteditable="true" data-field="totalsOverride.previousPagesTotal" data-manual-override="${totalsOverride.previousPagesTotal ? 'true' : 'false'}">${esc(previousPagesText)}</td></tr>` : ''}
              ${discountFils > 0 ? `<tr><td class="inv-tot-label">Discount</td><td class="inv-tot-value">${hasAnyAmounts ? `${InvoiceMath.filsToKD(discountFils)} KD.` : ''}</td></tr>` : ''}
              <tr class="inv-tot-grand"><td class="inv-tot-label"><strong>Total Payable Amount</strong></td><td class="inv-tot-value" contenteditable="true" data-field="totalsOverride.totalPayable" data-manual-override="${totalsOverride.totalPayable ? 'true' : 'false'}">${esc(totalPayableText)}</td></tr>
            </table>
          </div>
        </div>`;
      }

      html += renderInvoiceFooter(pageNum);
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderLetterhead() {
    const data = letterheadData;
    const allPages = normalizePages(data.pages, ITEMS_PER_PAGE_LETTERHEAD);
    data.pages = allPages;
    const totalPages = allPages.length;
    let html = '<div class="invoice-pages-wrapper">';

    for (let pi = 0; pi < totalPages; pi += 1) {
      const page = allPages[pi];
      const items = page.items || [];
      const pageNum = pi + 1;
      const pageViewData = resolveLetterheadPageData(data, page);

      html += `<div class="inv-page inv-page-landscape" data-page="${pageNum}">`;
      html += `<span class="inv-page-label">Page ${pageNum}</span>`;
      html += renderLetterheadHeader(pageViewData, pi, page);
      html += renderLetterheadTable(items, allPages, pi);
      html += renderLetterheadFooter();
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderLetterheadTable(items, allPages = [{ items }], pageIndex = 0) {
    let html = '<div class="inv-table-wrap"><table class="inv-table lh-table">';
    html += `<thead><tr>
      <th class="col-barcode"><div class="th-bi">الباركود<br>Barcode</div></th>
      <th class="col-product-by"><div class="th-bi">المنشأة<br>Product By</div></th>
      <th class="col-price"><div class="th-bi">السعر<br>Price</div></th>
      <th class="col-unit-price"><div class="th-bi">السعر الوحدة<br>Unit Price</div></th>
      <th class="col-qty"><div class="th-bi">العدد<br>Qty.</div></th>
      <th class="col-weight"><div class="th-bi">الوزن<br>Weight</div></th>
      <th class="col-name-en"><div class="th-bi">Name</div></th>
      <th class="col-name-ar"><div class="th-bi">اسم الصنف</div></th>
      <th class="col-sno"><div class="th-bi">S. no.</div></th>
    </tr></thead>`;
    html += '<tbody>';

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const totalFils = getItemTotalFils(item);
      const sno = index + 1;
      html += `<tr data-index="${index}">
        <td contenteditable="true" data-field="barcode">${esc(item.barcode)}</td>
        <td contenteditable="true" data-field="product_by">${esc(item.product_by || '')}</td>
        <td contenteditable="true" data-field="total" data-manual-override="${item.total_manual_override ? 'true' : 'false'}">${formatRowTotalCell(item, totalFils)}</td>
        <td contenteditable="true" data-field="unit_price">${formatUnitPriceCell(item)}</td>
        <td contenteditable="true" data-field="qty">${esc(String(item.qty || ''))}</td>
        <td contenteditable="true" data-field="weight">${esc(item.weight)}</td>
        <td contenteditable="true" data-field="name_en">${esc(item.name_en)}</td>
        <td contenteditable="true" data-field="name_ar" dir="rtl">${esc(item.name_ar)}</td>
        <td class="col-sno">${String(sno).padStart(2, '0')}</td>
      </tr>`;
    }

    for (let index = items.length; index < ITEMS_PER_PAGE_LETTERHEAD; index += 1) {
      const sno = index + 1;
      html += `<tr>
        <td contenteditable="true" data-field="barcode"></td>
        <td contenteditable="true" data-field="product_by"></td>
        <td contenteditable="true" data-field="total" data-manual-override="false"></td>
        <td contenteditable="true" data-field="unit_price"></td>
        <td contenteditable="true" data-field="qty"></td>
        <td contenteditable="true" data-field="weight"></td>
        <td contenteditable="true" data-field="name_en"></td>
        <td contenteditable="true" data-field="name_ar" dir="rtl"></td>
        <td class="col-sno">${String(sno).padStart(2, '0')}</td>
      </tr>`;
    }

    html += '</tbody></table></div>';
    return html;
  }

  function legacyRenderLetterheadFooter() {
    return `
      <div class="lh-footer">
        <div class="lh-footer-left">
          <div>Ù…Ù‚Ø¯Ù… Ø§Ù„Ø·Ù„Ø¨ :</div>
          <div>Ø§Ù„ØªÙˆÙ‚ÙŠØ¹ :</div>
        </div>
        <div class="lh-footer-right">
          <div>Ø´Ø§ÙƒØ±ÙŠÙ† Ùˆ Ù…Ù‚Ø¯Ø±ÙŠÙ† Ø­Ø³Ù† ØªØ¹Ø§ÙˆÙ†ÙƒÙ…ØŒ</div>
          <div>ÙˆØªÙØ¶Ù„ÙˆØ§ Ø¨Ù‚Ø¨ÙˆÙ„ ÙØ§Ø¦Ù‚ Ø§Ù„Ø§Ø­ØªØ±Ø§Ù… ÙˆØ§Ù„ØªÙ‚Ø¯ÙŠØ±.</div>
        </div>
      </div>`;
  }

  function legacyRenderLetterheadHeader(data, pageIndex, page) {
    const bindAttrs = buildFieldBindingAttrs(pageIndex, page);

    return `
      <div class="lh-header-manual">
        <div class="lh-top-grid">
          <div class="lh-left-brand">
            <div class="lh-left-brand-svg-wrap">
              <img src="assets/letterhead2.svg" alt="Al Ghanim gray brand" class="lh-left-brand-svg" />
            </div>
          </div>
          <div class="lh-cr-en">C.R. No. 431998</div>
          <div class="lh-center-brand">
            <div class="lh-center-mark-wrap">
              <img src="assets/logo-center-blue.svg" alt="Al Ghanim blue brand" class="lh-center-mark-svg" />
            </div>
          </div>
          <div class="lh-cr-ar" dir="rtl">رقم السجل تجاري : ٤٣١٩٩٨</div>
          <div class="lh-date-box">
            <span class="lh-date-label">Date:</span>
            <span class="lh-date-line">
              <span contenteditable="true" class="lh-date-value" data-field="date"${bindAttrs}>${esc(data.date || '')}</span>
            </span>
          </div>
        </div>
        <div class="lh-top-divider"></div>
      </div>
      <div class="lh-addressee">
        <div class="lh-addr-left">
          <div class="lh-addr-line">To : <strong contenteditable="true" data-field="to"${bindAttrs}>${esc(data.to || '')}</strong></div>
          <div class="lh-addr-line" contenteditable="true" data-field="area"${bindAttrs}>${esc(data.area || '')}</div>
          <div class="lh-addr-line">Greetings,</div>
        </div>
        <div class="lh-addr-right">
          <div class="lh-addr-ar">السادة / <span contenteditable="true" data-field="toAr"${bindAttrs}>${esc(data.toAr || '')}</span></div>
          <div class="lh-addr-ar" contenteditable="true" data-field="areaAr"${bindAttrs}>${esc(data.areaAr || '')}</div>
          <div class="lh-addr-ar">تحية طيبة وبعد ...</div>
        </div>
      </div>
      <div class="lh-subject">
        <div class="lh-subject-en"><strong>SUBJECT: </strong><span contenteditable="true" data-field="subject"${bindAttrs}>${esc(data.subject || '')}</span></div>
        <div class="lh-subject-ar"><strong>الموضوع: </strong><span contenteditable="true" data-field="subjectAr"${bindAttrs}>${esc(data.subjectAr || '')}</span></div>
      </div>
      <div class="lh-request">
        <span class="lh-req-en">We Kindly Request That You Approve The Items Offered By Us.</span>
        <span class="lh-req-ar">نرجو منكم التكرم باعتماد الاصناف المقدمة من قبلنا</span>
      </div>`;
  }

  function legacyDefaultLetterheadData() {
    return {
      date: '',
      to: '',
      toAr: '',
      area: '',
      areaAr: '',
      subject: 'OPENING FILE & ENTERING ITEMS',
      subjectAr: 'فتح ملف و إدخال أصناف',
      pages: [{ items: [] }],
      notes: ''
    };
  }

  function renderLetterheadFooter() {
    return `
      <div class="lh-footer">
        <div class="lh-footer-left">
          <div>مقدم الطلب :</div>
          <div>التوقيع :</div>
        </div>
        <div class="lh-footer-right">
          <div>شاكرين و مقدرين حسن تعاونكم،</div>
          <div>وتفضلوا بقبول فائق الاحترام والتقدير.</div>
        </div>
      </div>`;
  }

  function renderLetterheadHeader(data, pageIndex, page) {
    const bindAttrs = buildFieldBindingAttrs(pageIndex, page);

    return `
      <div class="lh-header-manual">
        <div class="lh-top-grid">
          <div class="lh-left-brand">
            <div class="lh-left-brand-svg-wrap">
              <img src="assets/letterhead2.svg" alt="Al Ghanim gray brand" class="lh-left-brand-svg" />
            </div>
          </div>
          <div class="lh-cr-en">C.R. No. 431998</div>
          <div class="lh-center-brand">
            <div class="lh-center-mark-wrap">
              <img src="assets/logo-center-blue.svg" alt="Al Ghanim blue brand" class="lh-center-mark-svg" />
            </div>
          </div>
          <div class="lh-cr-ar" dir="rtl">رقم السجل تجاري : ٤٣١٩٩٨</div>
          <div class="lh-date-box">
            <span class="lh-date-label">Date:</span>
            <span class="lh-date-line">
              <span contenteditable="true" class="lh-date-value" data-field="date"${bindAttrs}>${esc(data.date || '')}</span>
            </span>
          </div>
        </div>
        <div class="lh-top-divider"></div>
      </div>
      <div class="lh-addressee">
        <div class="lh-addr-left">
          <div class="lh-addr-line">To : <strong contenteditable="true" data-field="to"${bindAttrs}>${esc(data.to || '')}</strong></div>
          <div class="lh-addr-line" contenteditable="true" data-field="area"${bindAttrs}>${esc(data.area || '')}</div>
          <div class="lh-addr-line">Greetings,</div>
        </div>
        <div class="lh-addr-right">
          <div class="lh-addr-ar">السادة / <span contenteditable="true" data-field="toAr"${bindAttrs}>${esc(data.toAr || '')}</span></div>
          <div class="lh-addr-ar" contenteditable="true" data-field="areaAr"${bindAttrs}>${esc(data.areaAr || '')}</div>
          <div class="lh-addr-ar">تحية طيبة وبعد ...</div>
        </div>
      </div>
      <div class="lh-subject">
        <div class="lh-subject-en"><strong>SUBJECT: </strong><span contenteditable="true" data-field="subject"${bindAttrs}>${esc(data.subject || '')}</span></div>
        <div class="lh-subject-ar"><strong>الموضوع: </strong><span contenteditable="true" data-field="subjectAr"${bindAttrs}>${esc(data.subjectAr || '')}</span></div>
      </div>
      <div class="lh-request">
        <span class="lh-req-en">We Kindly Request That You Approve The Items Offered By Us.</span>
        <span class="lh-req-ar">نرجو منكم التكرم باعتماد الاصناف المقدمة من قبلنا</span>
      </div>`;
  }

  function normalizePages(pages, maxItems) {
    const sourcePages = Array.isArray(pages) && pages.length > 0 ? pages : [{ items: [] }];
    const normalized = [];

    sourcePages.forEach((page) => {
      const items = Array.isArray(page?.items) ? page.items : [];

      if (items.length === 0) {
        normalized.push({ ...page, items: [] });
        return;
      }

      for (let index = 0; index < items.length; index += maxItems) {
        normalized.push({
          ...page,
          items: items.slice(index, index + maxItems)
        });
      }
    });

    return normalized.length > 0 ? normalized : [{ items: [] }];
  }

  function getData() { return invoiceData; }

  function setData(data) {
    if (data && typeof data === 'object') {
      invoiceData = { ...defaultInvoiceData(), ...data };
      if (data.pages) invoiceData.pages = normalizeStoredPages(data.pages, 'invoice');
      if (data.billTo) invoiceData.billTo = { ...defaultInvoiceData().billTo, ...data.billTo };
      invoiceData.shareContact = { ...defaultInvoiceData().shareContact, ...(data.shareContact || {}) };
      invoiceData.totalsOverride = normalizeTotalsOverride(data.totalsOverride);
    }
  }

  function getLetterheadData() { return letterheadData; }

  function setLetterheadData(data) {
    if (data && typeof data === 'object') {
      letterheadData = { ...defaultLetterheadData(), ...data };
      if (data.pages) letterheadData.pages = normalizeStoredPages(data.pages, 'letterhead');
      letterheadData.shareContact = { ...defaultLetterheadData().shareContact, ...(data.shareContact || {}) };
    }
  }

  function ensurePageAtIndex(data, viewType, pageIndex) {
    const safeIndex = Math.max(0, parseInt(pageIndex, 10) || 0);
    if (!data.pages || data.pages.length === 0) {
      data.pages = [{ items: [] }];
    }

    while (data.pages.length <= safeIndex) {
      data.pages.push(createPageWithCopiedContactInfo(viewType, data));
    }

    if (!Array.isArray(data.pages[safeIndex].items)) {
      data.pages[safeIndex].items = [];
    }

    return data.pages[safeIndex];
  }

  function insertItemIntoPageFlow(data, viewType, item, maxItems, pageIndex) {
    const targetPage = ensurePageAtIndex(data, viewType, pageIndex);
    const insertIndex = targetPage.items.length >= maxItems
      ? Math.max(0, maxItems - 1)
      : targetPage.items.length;

    targetPage.items.splice(insertIndex, 0, item);

    let carry = targetPage.items.length > maxItems ? targetPage.items.pop() : null;
    let currentPageIndex = Math.max(0, parseInt(pageIndex, 10) || 0);

    while (carry) {
      currentPageIndex += 1;
      const nextPage = ensurePageAtIndex(data, viewType, currentPageIndex);
      nextPage.items.unshift(carry);
      carry = nextPage.items.length > maxItems ? nextPage.items.pop() : null;
    }
  }

  function addItem(itemIn, viewType, options = {}) {
    const isLetterhead = viewType === 'letterhead';
    const data = isLetterhead ? letterheadData : invoiceData;
    const maxItems = isLetterhead ? ITEMS_PER_PAGE_LETTERHEAD : ITEMS_PER_PAGE_INVOICE;

    const item = {
      barcode: itemIn.barcode || '',
      name_en: itemIn.name_en || itemIn.itemNameEN || '',
      name_ar: itemIn.name_ar || itemIn.itemNameAR || '',
      country: itemIn.country || '',
      weight: itemIn.weight || '',
      unit_price_fils: getItemUnitPriceFils(itemIn),
      qty: parseInt(itemIn.qty, 10) || 1,
      product_by: itemIn.product_by || itemIn.productBy || '',
      total_fils: 0,
      total_manual_override: !!itemIn.total_manual_override
    };
    item.total_fils = getItemTotalFils(item);

    if (Number.isInteger(options.pageIndex)) {
      insertItemIntoPageFlow(data, viewType, item, maxItems, options.pageIndex);
      return item;
    }

    if (!data.pages || data.pages.length === 0) data.pages = [createBlankPage(viewType)];
    let lastPage = data.pages[data.pages.length - 1];
    if (!Array.isArray(lastPage.items)) {
      lastPage.items = [];
    }
    if (lastPage.items.length >= maxItems) {
      data.pages.push(createPageWithCopiedContactInfo(viewType, data));
      lastPage = data.pages[data.pages.length - 1];
    }
    lastPage.items.push(item);
    return item;
  }

  function addPage(viewType) {
    const data = viewType === 'letterhead' ? letterheadData : invoiceData;
    if (!data.pages) data.pages = [];
    data.pages.push(createPageWithCopiedContactInfo(viewType, data));
    return data.pages.length;
  }

  function deletePage(viewType, pageIdx) {
    const data = viewType === 'letterhead' ? letterheadData : invoiceData;
    if (data.pages && data.pages.length > 1 && pageIdx >= 0 && pageIdx < data.pages.length) {
      data.pages.splice(pageIdx, 1);
    }
  }

  function duplicatePage(viewType, pageIdx) {
    const data = viewType === 'letterhead' ? letterheadData : invoiceData;
    if (data.pages && pageIdx >= 0 && pageIdx < data.pages.length) {
      const clone = JSON.parse(JSON.stringify(data.pages[pageIdx]));
      data.pages.splice(pageIdx + 1, 0, clone);
    }
  }

  function reorderPages(viewType, fromIdx, toIdx) {
    const data = viewType === 'letterhead' ? letterheadData : invoiceData;
    if (data.pages && fromIdx >= 0 && fromIdx < data.pages.length && toIdx >= 0 && toIdx < data.pages.length) {
      const [page] = data.pages.splice(fromIdx, 1);
      data.pages.splice(toIdx, 0, page);
    }
  }

  function resetInvoice() { invoiceData = defaultInvoiceData(); }
  function resetLetterhead() { letterheadData = defaultLetterheadData(); }

  function esc(str) {
    const host = document.createElement('div');
    host.textContent = str || '';
    return host.innerHTML;
  }

  function getItemsPerPage(viewType) {
    return viewType === 'letterhead' ? ITEMS_PER_PAGE_LETTERHEAD : ITEMS_PER_PAGE_INVOICE;
  }

  return {
    renderInvoice, renderLetterhead,
    getData, setData, getLetterheadData, setLetterheadData,
    addItem, addPage, deletePage, duplicatePage, reorderPages,
    resetInvoice, resetLetterhead,
    defaultInvoiceData, defaultLetterheadData,
    getItemsPerPage,
    ITEMS_PER_PAGE: ITEMS_PER_PAGE_INVOICE
  };
})();
